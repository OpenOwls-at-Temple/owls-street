"""
Vercel-specific lightweight entrypoint for Owls Street Pulse.

The full Pulse alert engine requires a persistent server with writable filesystem
(threading, SQLite, file-based config). This module provides a Vercel-compatible
FastAPI app that serves the dashboard UI and returns informational API responses
without importing the heavy engine/database/chat modules.

Authentication is fully functional here, unlike the engine: sessions are a signed JWT in a
cookie, so password sign-in and Google SSO need no database and no persistent process.
"""
import logging
import os
import sys
from datetime import datetime, timezone
from typing import Optional, List, Dict
from fastapi import FastAPI, Request, HTTPException, Response
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Ensure parent directory is in sys.path for resolving templates
PULSE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PULSE_ROOT not in sys.path:
    sys.path.insert(0, PULSE_ROOT)

from src import llm, sso
from src.auth_helper import create_jwt, verify_jwt, MOCK_GOOGLE_LOGIN_HTML

logger = logging.getLogger(__name__)

SESSION_COOKIE = "pulse_session_token"
SESSION_MAX_AGE = 30 * 24 * 3600

app = FastAPI(title="Owls Street Pulse API (Serverless)", version="1.0.0")

# Setup CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SERVERLESS_MSG = (
    "This endpoint is not available in serverless mode. "
    "The Owls Street Pulse alert engine requires a persistent server. "
    "Please deploy with Docker or a VPS for full functionality."
)

# Only /tmp is writable in a serverless function. The alert history stored here is
# discarded with the instance, which is fine: nothing writes to it in this mode, and chat
# treats it as optional context.
CHAT_DB_PATH = os.environ.get("WEB_DB_PATH", "/tmp/alerts.db")
CHAT_CONFIG_PATH = os.environ.get("WEB_CONFIG_PATH", "config/config.yaml")


def chat_available() -> bool:
    """Whether this deployment can reach an LLM at all."""
    return not llm.ollama_is_local()


def _serverless_chat_config():
    """Monitor/credential config for chat, or None when there is none to be had.

    config.yaml is gitignored, so a deployment only has one if it was committed
    deliberately — the same file the GitHub Actions engine needs. Without it chat still
    answers, just with no pre-calculated indicator context.
    """
    from src.config import load_config

    for candidate in (CHAT_CONFIG_PATH, os.path.join(PULSE_ROOT, "config", "config.yaml")):
        if not os.path.exists(candidate):
            continue
        try:
            return load_config(candidate)
        except Exception as e:
            logger.warning("Chat config at %s did not load (%s).", candidate, e)
    return None


# ── Dashboard HTML ─────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
def get_dashboard():
    """Serves the Pulse dashboard UI template."""
    template_path = os.path.join(PULSE_ROOT, "src", "templates", "index.html")
    if not os.path.exists(template_path):
        return HTMLResponse(
            content="<h1>Owls Street Pulse — Template not found</h1>"
            "<p>The dashboard template (src/templates/index.html) was not included in the deployment.</p>",
            status_code=404,
        )
    with open(template_path, "r") as f:
        html = f.read()
    return HTMLResponse(content=html)


# ── Authentication ─────────────────────────────────────────────────────────────
#
# Sessions are stateless: a JWT signed with SSO_JWT_SECRET, carried in a cookie. Nothing
# here needs the database or a long-lived process, so auth behaves the same as on a server.

def _auth_state(request: Request) -> dict:
    """Resolves what sign-in methods exist and whether this request is already signed in."""
    password = os.environ.get("DASHBOARD_PASSWORD")
    password_enabled = bool(password and password.strip())
    google_enabled = sso.google_configured()

    auth_enabled = password_enabled or google_enabled
    user = None
    authorized = not auth_enabled  # wide open only when nothing is configured

    token = request.cookies.get(SESSION_COOKIE)
    if token and auth_enabled:
        if password_enabled and token == password:
            authorized = True
        else:
            payload = verify_jwt(token)
            if payload:
                authorized = True
                user = {
                    "email": payload.get("email"),
                    "name": payload.get("name"),
                    "provider": payload.get("provider"),
                    "avatar": payload.get("avatar"),
                }

    return {
        "auth_enabled": auth_enabled,
        "authorized": authorized,
        "password_enabled": password_enabled,
        "google_enabled": google_enabled,
        "user": user,
    }


def _require_auth(request: Request) -> dict:
    state = _auth_state(request)
    if not state["authorized"]:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return state


def _session_redirect(target: str, token: str) -> RedirectResponse:
    response = RedirectResponse(url=target)
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=SESSION_MAX_AGE,
    )
    response.delete_cookie(sso.STATE_COOKIE)
    return response


# ── Informational API Endpoints ────────────────────────────────────────────────

@app.get("/api/status")
def get_status(request: Request):
    """Returns a status response indicating serverless mode."""
    state = _auth_state(request)
    return {
        "engine_status": "serverless",
        "uptime_seconds": 0,
        "last_check_time": None,
        "active_monitors_count": 0,
        "active_rules_count": 0,
        "sqlite_db_size_bytes": 0,
        "poll_interval_seconds": 0,
        "error_count": 0,
        "last_error": None,
        "auth_enabled": state["auth_enabled"],
        "authorized": state["authorized"],
        "user": state["user"],
        "google_sso_configured": state["google_enabled"],
        "serverless_mode": True,
        "chat_available": chat_available(),
        "message": (
            "Running in Vercel serverless mode. "
            "The alert engine and its database require a persistent server; "
            "chat works when OLLAMA_BASE_URL points at a reachable endpoint."
        ),
    }


@app.get("/api/auth/config")
def get_auth_config(request: Request):
    """Reports which sign-in methods this deployment actually offers."""
    state = _auth_state(request)
    return {
        "auth_enabled": state["auth_enabled"],
        "authorized": state["authorized"],
        "password_enabled": state["password_enabled"],
        "google_enabled": state["google_enabled"],
    }


@app.get("/api/auth/google/login")
def google_login(request: Request, redirect_to: Optional[str] = None):
    client_id, _, configured_redirect, _ = sso.resolve_google_credentials()

    if not client_id:
        if sso.mock_sso_enabled():
            state = sso.new_state()
            response = RedirectResponse(url=f"/auth/google-mock/login?state={state}")
        else:
            raise HTTPException(
                status_code=503,
                detail="Google SSO is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
            )
    else:
        state = sso.new_state()
        response = RedirectResponse(
            sso.google_auth_url(client_id, sso.callback_url(request, configured_redirect), state)
        )

    response.set_cookie(
        key=sso.STATE_COOKIE, value=state, httponly=True, secure=True, samesite="lax", max_age=600
    )
    response.set_cookie(
        key=sso.ORIGIN_COOKIE,
        value=redirect_to or request.headers.get("referer") or "/",
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=600,
    )
    return response


@app.get("/auth/google-mock/login", response_class=HTMLResponse)
def google_mock_login(state: Optional[str] = None):
    if not sso.mock_sso_enabled():
        raise HTTPException(status_code=404, detail="Not found")
    return HTMLResponse(content=MOCK_GOOGLE_LOGIN_HTML)


@app.get("/api/auth/google/callback")
async def google_callback(
    request: Request,
    code: str,
    state: Optional[str] = None,
    email: Optional[str] = None,
    name: Optional[str] = None,
):
    client_id, client_secret, configured_redirect, allowed = sso.resolve_google_credentials()

    try:
        sso.verify_state(request, state)

        if code == "mock_code" or not (client_id and client_secret):
            # Only the local development path may skip the token exchange, and only when
            # explicitly enabled. Otherwise a caller could hand itself any identity.
            if not sso.mock_sso_enabled():
                raise sso.SsoError("Google SSO is not configured for this deployment.")
            user_email = email
            if not user_email:
                raise sso.SsoError("Mock sign-in requires an email address.")
            user_name = name or user_email.split("@")[0]
        else:
            user_email, user_name = await sso.exchange_google_code(
                client_id, client_secret, code, sso.callback_url(request, configured_redirect)
            )

        sso.check_email_allowed(user_email, allowed)
    except sso.SsoError as e:
        raise HTTPException(status_code=403, detail=str(e))

    token = create_jwt(sso.session_payload(user_email, user_name))
    origin = (request.cookies.get(sso.ORIGIN_COOKIE) or "/").rstrip("/")
    logger.info("Google SSO login successful for %s", user_email)
    return _session_redirect(f"{origin}/", token)


# ── Endpoints That Require the Full Engine ─────────────────────────────────────

@app.get("/api/config")
def get_config():
    return JSONResponse(
        status_code=503,
        content={"status": "unavailable", "message": SERVERLESS_MSG},
    )


@app.post("/api/config")
def update_config():
    return JSONResponse(
        status_code=503,
        content={"status": "unavailable", "message": SERVERLESS_MSG},
    )


@app.get("/api/alerts")
def get_alerts():
    return JSONResponse(
        status_code=503,
        content={
            "status": "unavailable",
            "message": SERVERLESS_MSG,
            "alerts": [],
        },
    )


@app.post("/api/alerts/clear")
def clear_alerts():
    return JSONResponse(
        status_code=503,
        content={"status": "unavailable", "message": SERVERLESS_MSG},
    )


@app.post("/api/engine/start")
def start_engine():
    return JSONResponse(
        status_code=503,
        content={"status": "unavailable", "message": SERVERLESS_MSG},
    )


@app.post("/api/engine/stop")
def stop_engine():
    return JSONResponse(
        status_code=503,
        content={"status": "unavailable", "message": SERVERLESS_MSG},
    )


@app.post("/api/test-alert/{rule_id}")
def test_alert(rule_id: str):
    return JSONResponse(
        status_code=503,
        content={"status": "unavailable", "message": SERVERLESS_MSG},
    )


class ChatRequest(BaseModel):
    message: str
    symbol: Optional[str] = None
    history: Optional[List[Dict[str, str]]] = None
    images: Optional[List[str]] = None


@app.post("/api/chat")
async def chat(payload: ChatRequest, request: Request):
    """Owl Speaks chat.

    Unlike the engine, chat has nothing that needs a persistent process: it is one
    outbound call to an LLM. What it does need is an Ollama endpoint reachable from a
    serverless function, so it works here exactly when OLLAMA_BASE_URL points at a
    routable host rather than the loopback default.

    Market context degrades rather than fails — no config file means no monitors, and a
    read-only filesystem means no alert history, but the model still answers.
    """
    _require_auth(request)

    if not chat_available():
        return JSONResponse(
            status_code=503,
            content={
                "status": "unavailable",
                "message": (
                    "The Owl Speaks chat agent needs an Ollama endpoint reachable from this "
                    "deployment, and OLLAMA_BASE_URL currently points at a loopback address "
                    "a serverless function has no access to. Set OLLAMA_API_KEY to use "
                    "Ollama Cloud, or point OLLAMA_BASE_URL at a publicly routable endpoint."
                ),
            },
        )

    # Imported here, not at module scope: the chat agent pulls in pandas and the Alpaca
    # client, and every other endpoint in this app would otherwise pay for it on a cold
    # start it never uses.
    from src.chat import OwlSpeaksAgent

    try:
        config = _serverless_chat_config()
        agent = OwlSpeaksAgent(config, db_path=CHAT_DB_PATH)
        response_text = await agent.generate_response(
            user_message=payload.message,
            symbol=payload.symbol,
            history=payload.history,
            images=payload.images,
        )
        return {"status": "success", "response": response_text}
    except Exception as e:
        logger.error("Error in serverless /api/chat: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to communicate with LLM: {e}")


# ── Password sign-in / sign-out ────────────────────────────────────────────────

class LoginRequest(BaseModel):
    password: Optional[str] = None


@app.post("/api/auth/login")
def login(payload: LoginRequest, response: Response):
    """Password sign-in. Mirrors the daemon app, including the cookie name."""
    password = os.environ.get("DASHBOARD_PASSWORD")
    if not password or not password.strip():
        return {"status": "success", "message": "Password auth is not enabled"}

    if payload.password == password:
        response.set_cookie(
            key=SESSION_COOKIE,
            value=password,
            httponly=True,
            secure=True,
            samesite="lax",
            max_age=SESSION_MAX_AGE,
        )
        return {"status": "success", "message": "Logged in successfully"}

    raise HTTPException(status_code=400, detail="Invalid password")


@app.post("/api/auth/logout")
def logout(response: Response):
    response.delete_cookie(SESSION_COOKIE)
    return {"status": "success"}


# ── Catch-all for unmatched routes ─────────────────────────────────────────────

@app.api_route("/{full_path:path}", methods=["GET", "POST", "PUT", "DELETE"])
def catch_all(full_path: str):
    """Catch-all to provide a helpful error instead of a generic 404."""
    if full_path.startswith("api/"):
        return JSONResponse(
            status_code=503,
            content={"status": "unavailable", "message": SERVERLESS_MSG},
        )
    # For non-API paths, serve the dashboard
    return get_dashboard()
