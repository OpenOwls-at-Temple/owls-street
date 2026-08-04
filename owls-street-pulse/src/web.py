import os
import time
import logging
import threading
from datetime import datetime, timezone
from typing import Dict, Any, Optional, List
import hashlib
from fastapi import FastAPI, Request, Response, HTTPException, Depends
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from src.auth_helper import verify_jwt, create_jwt, MOCK_GOOGLE_LOGIN_HTML
from src import sso

from src.config import load_config, save_config, AppConfig
from src.engine import AlertEngine
from src.database import StateDatabase
from src.chat import OwlSpeaksAgent

logger = logging.getLogger(__name__)

# Thread-safe global background engine runner
class BackgroundEngineRunner:
    def __init__(self):
        self.thread = None
        self.running = False
        self.config_path = None
        self.db_path = None
        self.engine = None
        self.last_check_time = None
        self.status = "stopped"
        self.start_time = None
        self.reload_flag = False
        self.error_count = 0
        self.last_error = None

    def loop(self):
        logger.info("Background Alert Engine thread started.")
        self.start_time = time.time()
        self.status = "running"
        self.error_count = 0
        
        while self.running:
            try:
                # Dynamically instantiate or reload engine
                if self.reload_flag or self.engine is None:
                    config = load_config(self.config_path)
                    self.engine = AlertEngine(config, db_path=self.db_path)
                    self.reload_flag = False
                    logger.info("Background Alert Engine loaded configuration.")

                self.engine.run_checks()
                self.last_check_time = datetime.now(timezone.utc).isoformat()
            except Exception as e:
                self.error_count += 1
                self.last_error = str(e)
                logger.error(f"Error in background alert engine check: {e}", exc_info=True)

            # Sleep interruptibly so we stop or reload immediately on command
            poll_interval = self.engine.config.poll_interval_seconds if self.engine else 60
            start_sleep = time.time()
            while self.running and not self.reload_flag and (time.time() - start_sleep < poll_interval):
                time.sleep(1)

        self.status = "stopped"
        logger.info("Background Alert Engine thread stopped.")

    def start(self, config_path: str, db_path: str):
        if self.running:
            return
        self.config_path = config_path
        self.db_path = db_path
        self.running = True
        self.thread = threading.Thread(target=self.loop, daemon=True)
        self.thread.start()

    def stop(self):
        self.running = False
        if self.thread:
            self.thread.join(timeout=5)
            self.thread = None

    def trigger_reload(self):
        self.reload_flag = True

# Instantiate global runner
runner = BackgroundEngineRunner()

# Create FastAPI app
app = FastAPI(title="Owls Street Pulse API", version="1.0.0")

# Setup CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

import urllib.parse
import secrets
import httpx
from fastapi.responses import RedirectResponse

# Google OAuth Configuration
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET")

def get_google_sso_credentials(config):
    client_id = (config.google_sso.client_id if (config and config.google_sso) else None) or os.environ.get("GOOGLE_CLIENT_ID")
    client_secret = (config.google_sso.client_secret if (config and config.google_sso) else None) or os.environ.get("GOOGLE_CLIENT_SECRET")
    redirect_uri = (config.google_sso.redirect_uri if (config and config.google_sso) else None) or os.environ.get("GOOGLE_REDIRECT_URI")
    allowed_emails = (config.google_sso.allowed_emails if (config and config.google_sso) else None) or os.environ.get("ALLOWED_EMAILS")
    return client_id, client_secret, redirect_uri, allowed_emails

# Authentication dependency
def verify_dashboard_password(request: Request):
    global active_sessions
    password = os.environ.get("DASHBOARD_PASSWORD")
    
    try:
        config = load_config(CONFIG_PATH)
        google_enabled = bool(config.google_sso and config.google_sso.client_id)
    except Exception:
        google_enabled = False
        
    password_enabled = bool(password and password.strip() != "")
    
    if not (password_enabled or google_enabled):
        return True  # Auth is disabled if none are set
        
    # Pulse's own cookie first, then the view's, so one sign-in covers both dashboards when
    # they share a domain. See sso.session_tokens for why trusting the view's is sound.
    for token in sso.session_tokens(request):
        if password_enabled and token == password:
            return True
        if verify_jwt(token):
            return True

    raise HTTPException(status_code=401, detail="Unauthorized")

# Initialize Web Configuration paths from environment (passed from CLI)
CONFIG_PATH = os.environ.get("WEB_CONFIG_PATH", "config/config.yaml")
DB_PATH = os.environ.get("WEB_DB_PATH", "data/alerts.db")

@app.on_event("startup")
def startup_event():
    # Start the engine thread immediately on web server startup
    runner.start(CONFIG_PATH, DB_PATH)

@app.on_event("shutdown")
def shutdown_event():
    # Stop background engine runner
    runner.stop()

# ----------------- UI Dashboard HTML Endpoint -----------------

@app.get("/", response_class=HTMLResponse)
def get_dashboard():
    """Serves the Single Page Application UI template."""
    template_path = os.path.join(os.path.dirname(__file__), "templates", "index.html")
    if not os.path.exists(template_path):
        return HTMLResponse(
            content="<h1>Template index.html not found!</h1>",
            status_code=404
        )
    with open(template_path, "r") as f:
        html = f.read()
    return html

# ----------------- API Endpoints -----------------

@app.get("/api/auth/config")
def get_auth_config(request: Request):
    password = os.environ.get("DASHBOARD_PASSWORD")
    
    try:
        config = load_config(CONFIG_PATH)
        g_id, _, _, _ = get_google_sso_credentials(config)
        google_enabled = bool(g_id)
    except Exception:
        google_enabled = False
        
    password_enabled = bool(password and password.strip() != "")
    auth_enabled = password_enabled or google_enabled
    
    authorized = False
    if not auth_enabled:
        authorized = True
    else:
        token = request.cookies.get("pulse_session_token")
        if token:
            if password_enabled and token == password:
                authorized = True
            else:
                payload = verify_jwt(token)
                if payload:
                    authorized = True
                
    return {
        "auth_enabled": auth_enabled,
        "authorized": authorized,
        "password_enabled": password_enabled,
        "google_enabled": google_enabled
    }

@app.get("/auth/google-mock/login", response_class=HTMLResponse)
def google_mock_login(state: Optional[str] = None):
    if not sso.mock_sso_enabled():
        raise HTTPException(status_code=404, detail="Not found")
    return HTMLResponse(content=MOCK_GOOGLE_LOGIN_HTML)


def _google_credentials():
    """Credentials from the config file when it loads, else the environment."""
    try:
        config = load_config(CONFIG_PATH)
    except Exception:
        config = None
    return sso.resolve_google_credentials(config)


@app.get("/api/auth/google/login")
def google_login(request: Request, redirect_to: Optional[str] = None):
    referer = redirect_to or request.headers.get("referer") or "/"
    client_id, _, configured_redirect, _ = _google_credentials()

    # Random per attempt and verified on the way back, so the callback cannot be replayed
    # or forged from another origin. This was previously a fixed string.
    state = sso.new_state()

    if client_id:
        response = RedirectResponse(
            sso.google_auth_url(client_id, sso.callback_url(request, configured_redirect), state)
        )
    elif sso.mock_sso_enabled():
        response = RedirectResponse(url=f"/auth/google-mock/login?state={state}")
    else:
        raise HTTPException(
            status_code=503,
            detail="Google SSO is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
        )

    response.set_cookie(key=sso.STATE_COOKIE, value=state, httponly=True, samesite="lax", max_age=600)
    response.set_cookie(key=sso.ORIGIN_COOKIE, value=referer, httponly=True, samesite="lax")
    return response

@app.get("/api/auth/google/callback")
async def google_callback(request: Request, response: Response, code: str, state: Optional[str] = None, email: Optional[str] = None, name: Optional[str] = None):
    client_id, client_secret, configured_redirect, allowed_emails_str = _google_credentials()

    try:
        sso.verify_state(request, state)

        # No fallback identity. Skipping the token exchange is a development-only path and
        # must be enabled explicitly — otherwise a caller passing code=mock_code could hand
        # itself any email it liked.
        if code == "mock_code" or not (client_id and client_secret):
            if not sso.mock_sso_enabled():
                raise sso.SsoError("Google SSO is not configured for this deployment.")
            if not email:
                raise sso.SsoError("Mock sign-in requires an email address.")
            user_email = email
            user_name = name or email.split("@")[0]
        else:
            user_email, user_name = await sso.exchange_google_code(
                client_id, client_secret, code, sso.callback_url(request, configured_redirect)
            )

        sso.check_email_allowed(user_email, allowed_emails_str)
    except sso.SsoError as e:
        raise HTTPException(status_code=403, detail=str(e))

    jwt_token = create_jwt(sso.session_payload(user_email, user_name))
    logger.info("Google SSO login successful for %s", user_email)

    origin = request.cookies.get("sso_redirect_origin") or "/"
    if origin.endswith("/"):
        origin = origin[:-1]
        
    redirect_target = f"{origin}/"
    res_redirect = RedirectResponse(url=redirect_target)
    res_redirect.set_cookie(
        key="pulse_session_token",
        value=jwt_token,
        httponly=True,
        samesite="lax",
        max_age=30 * 24 * 3600
    )
    res_redirect.delete_cookie(sso.ORIGIN_COOKIE)
    res_redirect.delete_cookie(sso.STATE_COOKIE)
    return res_redirect

# Temple SSO endpoints removed

@app.post("/api/auth/login")
def login(payload: dict, response: Response):
    """Authenticates user and sets session cookie."""
    password = os.environ.get("DASHBOARD_PASSWORD")
    if not password:
        return {"status": "success", "message": "Auth disabled"}
        
    user_password = payload.get("password")
    if user_password == password:
        response.set_cookie(
            key="pulse_session_token",
            value=password,
            httponly=True,
            samesite="lax",
            max_age=30 * 24 * 3600
        )
        return {"status": "success", "message": "Logged in successfully"}
    
    raise HTTPException(status_code=400, detail="Invalid password")

@app.post("/api/auth/logout")
def logout(response: Response):
    """Logs out the user by deleting cookie."""
    response.delete_cookie("pulse_session_token")
    return {"status": "success"}

@app.get("/api/status")
def get_status(request: Request):
    """Returns runtime status of the alert engine and system parameters, including SSO configuration."""
    password = os.environ.get("DASHBOARD_PASSWORD")
    try:
        config = load_config(CONFIG_PATH)
        g_id, _, _, _ = get_google_sso_credentials(config)
        google_enabled = bool(g_id)
    except Exception:
        google_enabled = False
        
    auth_required = bool(password and password.strip() != "") or google_enabled
    authorized = False
    user_info = None
    
    token = request.cookies.get("pulse_session_token")
    if not auth_required:
        authorized = True
    elif password and token == password:
        authorized = True
        user_info = {"email": "admin@pulse", "name": "Admin User", "provider": "password"}
    else:
        payload = verify_jwt(token)
        if payload:
            authorized = True
            user_info = {
                "email": payload.get("email"),
                "name": payload.get("name"),
                "provider": payload.get("provider"),
                "avatar": payload.get("avatar")
            }
    db = StateDatabase(db_path=DB_PATH)
    
    db_size = 0
    if os.path.exists(DB_PATH):
        db_size = os.path.getsize(DB_PATH)

    active_monitors = 0
    active_rules = 0
    if runner.engine and runner.engine.config:
        active_monitors = len(runner.engine.config.monitors)
        active_rules = sum(len(m.rules) for m in runner.engine.config.monitors)

    uptime = 0
    if runner.start_time:
        uptime = int(time.time() - runner.start_time)

    status_str = runner.status if (runner.status and runner.status != "stopped") else "online"
    return {
        "engine_status": status_str,
        "uptime_seconds": uptime,
        "last_check_time": runner.last_check_time,
        "active_monitors_count": active_monitors,
        "active_rules_count": active_rules,
        "sqlite_db_size_bytes": db_size,
        "poll_interval_seconds": runner.engine.config.poll_interval_seconds if runner.engine else 60,
        "error_count": runner.error_count,
        "last_error": runner.last_error,
        "auth_enabled": auth_required,
        "authorized": authorized,
        "user": user_info,
        "google_sso_configured": bool(GOOGLE_CLIENT_ID)
    }

@app.get("/api/config", dependencies=[Depends(verify_dashboard_password)])
def get_current_config():
    """Returns the parsed configurations."""
    try:
        config = load_config(CONFIG_PATH)
        return config.model_dump()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load config: {str(e)}")

@app.post("/api/config", dependencies=[Depends(verify_dashboard_password)])
def update_current_config(config_data: dict):
    """Validates the input config data, saves it to YAML, and reloads the engine."""
    try:
        # Validate using Pydantic model
        validated_config = AppConfig.model_validate(config_data)
        
        # Save validated configuration back to YAML
        save_config(validated_config, CONFIG_PATH)
        
        # Notify background thread to reload config immediately
        runner.trigger_reload()
        
        return {"status": "success", "message": "Configuration updated and Alert Engine reloaded."}
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Validation failed: {str(e)}")

@app.get("/api/alerts", dependencies=[Depends(verify_dashboard_password)])
def get_alerts_history(limit: int = 50):
    """Fetches the list of recently triggered alerts from the SQLite database."""
    try:
        db = StateDatabase(db_path=DB_PATH)
        return db.get_all_alerts(limit=limit)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch alert logs: {str(e)}")

@app.post("/api/alerts/clear", dependencies=[Depends(verify_dashboard_password)])
def clear_alerts_history():
    """Clears all logged alerts from history."""
    try:
        db = StateDatabase(db_path=DB_PATH)
        db.clear_history()
        return {"status": "success", "message": "Alert history cleared."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to clear alert logs: {str(e)}")

@app.post("/api/engine/start", dependencies=[Depends(verify_dashboard_password)])
def start_engine():
    """Starts the background alert engine thread."""
    if runner.running:
        return {"status": "success", "message": "Engine already running"}
    runner.start(CONFIG_PATH, DB_PATH)
    return {"status": "success", "message": "Engine started"}

@app.post("/api/engine/stop", dependencies=[Depends(verify_dashboard_password)])
def stop_engine():
    """Stops the background alert engine thread."""
    if not runner.running:
        return {"status": "success", "message": "Engine already stopped"}
    runner.stop()
    return {"status": "success", "message": "Engine stopped"}

@app.post("/api/test-alert/{rule_id}", dependencies=[Depends(verify_dashboard_password)])
def trigger_test_alert(rule_id: str):
    """Manually triggers a test alert for the given rule to check integration channels."""
    if not runner.engine:
        raise HTTPException(status_code=400, detail="Alert engine is not initialized or is stopped.")
    
    # Search for rule config
    target_rule = None
    target_symbol = None
    target_asset = None
    
    for monitor in runner.engine.config.monitors:
        for rule in monitor.rules:
            if rule.id == rule_id:
                target_rule = rule
                target_symbol = monitor.symbol
                target_asset = monitor.asset_class
                break
                
    if not target_rule:
        raise HTTPException(status_code=404, detail=f"Rule ID '{rule_id}' not found.")
        
    try:
        # Mock values for a test alert
        mock_value = target_rule.condition.value if target_rule.condition.value is not None else 50.0
        bar_time_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        
        mock_metadata = {
            f"TEST_RUN": 1.0,
            f"{target_rule.indicator}_TEST": mock_value
        }
        
        # Dispatch the alert via notifier
        runner.engine.notifier.send_alert(
            symbol=target_symbol,
            rule_name=f"[TEST] {target_rule.name}",
            timeframe=target_rule.timeframe,
            indicator=target_rule.indicator,
            value=mock_value,
            bar_time=bar_time_str,
            operator=target_rule.condition.operator,
            condition_val=target_rule.condition.value,
            metadata=mock_metadata
        )
        
        # Also write the test alert to history for verification in UI
        runner.engine.db.update_trigger_state(
            rule_id=target_rule.id,
            symbol=target_symbol,
            bar_time=bar_time_str,
            value=mock_value
        )
        
        return {"status": "success", "message": f"Test alert sent for rule: {target_rule.name}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to dispatch test alert: {str(e)}")

# ----------------- Chat Endpoint -----------------

class ChatRequest(BaseModel):
    message: str
    symbol: Optional[str] = None
    history: Optional[List[Dict[str, str]]] = None
    images: Optional[List[str]] = None

@app.post("/api/chat", dependencies=[Depends(verify_dashboard_password)])
async def chat_with_owl(payload: ChatRequest):
    """Sends a chat message to the local Owl Speaks agent and returns the response."""
    logger.info(f"Received chat request: message_len={len(payload.message)}, symbol={payload.symbol}, history_len={len(payload.history) if payload.history else 0}, images={payload.images}")
    try:
        # Market context is an enrichment, not a prerequisite. A config that won't load —
        # most often absent Alpaca credentials — used to fail the whole request, so a
        # question needing no market data at all ("what does RSI measure?") returned a 500.
        try:
            config = load_config(CONFIG_PATH)
        except Exception as e:
            logger.warning("Chat running without market context; config did not load: %s", e)
            config = None
        agent = OwlSpeaksAgent(config, db_path=DB_PATH)
        response_text = await agent.generate_response(
            user_message=payload.message,
            symbol=payload.symbol,
            history=payload.history,
            images=payload.images
        )
        return {"status": "success", "response": response_text}
    except Exception as e:
        logger.error(f"Error in /api/chat endpoint: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to communicate with LLM: {str(e)}")
