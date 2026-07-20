import os
import json
import logging
import asyncio
from typing import Optional, Dict, List, Any
import hashlib
from fastapi import FastAPI, Request, Response, HTTPException, Depends, WebSocket, WebSocketDisconnect, Form
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from src.auth_helper import verify_jwt, create_jwt, MOCK_GOOGLE_LOGIN_HTML
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError, BaseModel

from src.config import AppConfig
from src.alpaca_service import (
    AlpacaService,
    MarketOrderBody,
    LimitOrderBody,
    AdvancedOrderBody,
    ReplaceOrderBody,
    ClosePositionBody,
    ScreenerRequest,
    is_option_symbol,
)
from alpaca.data.live import StockDataStream
from alpaca.data.live.option import OptionDataStream

logger = logging.getLogger(__name__)

# FastAPI app
app = FastAPI(title="Owl Street View API", version="1.0.0")

# Setup CORS (allows local React dev servers on 3000 and 5173)
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

# Global services initialized at startup
alpaca_service: Optional[AlpacaService] = None
dashboard_password: Optional[str] = None
pulse_url: str = "http://localhost:8000"
app_config: Optional[AppConfig] = None
active_sessions = set()


# Request timing middleware for telemetry
@app.middleware("http")
async def request_timing_middleware(request: Request, call_next):
    import time
    start = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = (time.perf_counter() - start) * 1000
    response.headers["X-Server-Timing-Ms"] = f"{elapsed_ms:.2f}"
    return response

# Google OAuth Configuration
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET")

def get_google_sso_credentials(config):
    client_id = (config.google_sso.client_id if (config and config.google_sso) else None) or os.environ.get("GOOGLE_CLIENT_ID")
    client_secret = (config.google_sso.client_secret if (config and config.google_sso) else None) or os.environ.get("GOOGLE_CLIENT_SECRET")
    redirect_uri = (config.google_sso.redirect_uri if (config and config.google_sso) else None) or os.environ.get("GOOGLE_REDIRECT_URI")
    allowed_emails = (config.google_sso.allowed_emails if (config and config.google_sso) else None) or os.environ.get("ALLOWED_EMAILS")
    return client_id, client_secret, redirect_uri, allowed_emails

def get_microsoft_sso_credentials(config):
    client_id = (config.microsoft_sso.client_id if (config and config.microsoft_sso) else None) or os.environ.get("MICROSOFT_CLIENT_ID")
    client_secret = (config.microsoft_sso.client_secret if (config and config.microsoft_sso) else None) or os.environ.get("MICROSOFT_CLIENT_SECRET")
    redirect_uri = (config.microsoft_sso.redirect_uri if (config and config.microsoft_sso) else None) or os.environ.get("MICROSOFT_REDIRECT_URI")
    allowed_emails = (config.microsoft_sso.allowed_emails if (config and config.microsoft_sso) else None) or os.environ.get("MICROSOFT_ALLOWED_EMAILS")
    return client_id, client_secret, redirect_uri, allowed_emails

# Dependency to check password auth cookie or JWT
def verify_dashboard_password(request: Request):
    global dashboard_password, active_sessions, app_config
    
    # Check if authentication is enabled overall
    g_id, _, _, _ = get_google_sso_credentials(app_config)
    m_id, _, _, _ = get_microsoft_sso_credentials(app_config)
    
    google_enabled = bool(g_id)
    microsoft_enabled = bool(m_id)
    password_enabled = bool(dashboard_password and dashboard_password.strip() != "")
    
    if not (password_enabled or google_enabled or microsoft_enabled):
        return True
        
    token = request.cookies.get("session_token")
    if not token:
        raise HTTPException(status_code=401, detail="Unauthorized")
        
    if password_enabled and token == dashboard_password:
        return True
        
    payload = verify_jwt(token)
    if payload:
        return True
        
    raise HTTPException(status_code=401, detail="Unauthorized")

@app.on_event("startup")
def startup_event():
    config_path = os.environ.get("WEB_CONFIG_PATH", "config/config.yaml")
    if os.path.exists(config_path):
        try:
            from src.config import load_config
            config = load_config(config_path)
            init_web_service(config)
            logger.info(f"Loaded config from '{config_path}' and initialized Alpaca Service.")
            return
        except Exception as e:
            logger.error(f"Error loading configuration from file: {e}", exc_info=True)

    try:
        from src.config import load_config_from_env
        config = load_config_from_env()
        init_web_service(config)
        logger.info("Initialized Alpaca Service from environment variables.")
    except Exception as e:
        logger.error(f"Error initializing configuration from env: {e}", exc_info=True)

def init_web_service(config: AppConfig):
    global alpaca_service, dashboard_password, pulse_url, app_config
    app_config = config
    dashboard_password = config.dashboard_password or os.environ.get("DASHBOARD_PASSWORD")
    pulse_url = config.pulse_url
    
    is_paper = config.alpaca.mode.lower() == "paper"
    alpaca_service = AlpacaService(
        api_key=config.alpaca.api_key,
        secret_key=config.alpaca.api_secret,
        is_paper=is_paper,
        fmp_api_key=config.fmp.api_key
    )
    logger.info("AlpacaService initialized in web app.")

# ── Authentication Routes ──────────────────────────────────────────────────────

@app.get("/api/auth/config")
def get_auth_config(request: Request):
    global dashboard_password, app_config
    
    g_id, _, _, _ = get_google_sso_credentials(app_config)
    m_id, _, _, _ = get_microsoft_sso_credentials(app_config)
    
    google_enabled = bool(g_id)
    microsoft_enabled = bool(m_id)
    password_enabled = bool(dashboard_password and dashboard_password.strip() != "")
    
    auth_enabled = password_enabled or google_enabled or microsoft_enabled
    
    authorized = False
    if not auth_enabled:
        authorized = True
    else:
        token = request.cookies.get("session_token")
        if token:
            if password_enabled and token == dashboard_password:
                authorized = True
            else:
                payload = verify_jwt(token)
                if payload:
                    authorized = True
                
    return {
        "auth_enabled": auth_enabled,
        "authorized": authorized,
        "password_enabled": password_enabled,
        "google_enabled": google_enabled,
        "google_client_id": g_id,
        "microsoft_enabled": microsoft_enabled,
        "microsoft_client_id": m_id
    }

@app.get("/auth/google-mock/login", response_class=HTMLResponse)
def google_mock_login(state: Optional[str] = None):
    return HTMLResponse(content=MOCK_GOOGLE_LOGIN_HTML)

@app.get("/api/auth/google/login")
def google_login(request: Request, redirect_to: Optional[str] = None):
    referer = redirect_to or request.headers.get("referer") or "/"
    
    client_id, _, _, _ = get_google_sso_credentials(app_config)
    
    if client_id and client_id != "mock":
        state = "google_state"
        redirect_uri = f"{request.base_url}api/auth/google/callback"
        auth_url = (
            f"https://accounts.google.com/o/oauth2/v2/auth?"
            f"client_id={client_id}&"
            f"response_type=code&"
            f"scope=openid%20email%20profile&"
            f"redirect_uri={redirect_uri}&"
            f"state={state}"
        )
        response = RedirectResponse(auth_url)
    else:
        state = "google_state"
        response = RedirectResponse(url=f"/auth/google-mock/login?state={state}")
        
    response.set_cookie(key="sso_redirect_origin", value=referer, httponly=True, samesite="lax")
    return response

@app.get("/api/auth/google/callback")
async def google_callback(request: Request, response: Response, code: str, state: Optional[str] = None, email: Optional[str] = None, name: Optional[str] = None):
    user_email = email or "shuv@gmail.com"
    user_name = name or "Shuv"
    
    client_id, client_secret, _, allowed_emails_str = get_google_sso_credentials(app_config)
    
    if client_id and client_secret and code != "mock_code":
        import httpx
        try:
            redirect_uri = f"{request.base_url}api/auth/google/callback"
            async with httpx.AsyncClient() as client:
                token_res = await client.post(
                    "https://oauth2.googleapis.com/token",
                    data={
                        "client_id": client_id,
                        "client_secret": client_secret,
                        "code": code,
                        "grant_type": "authorization_code",
                        "redirect_uri": redirect_uri
                    }
                )
                token_data = token_res.json()
                access_token = token_data.get("access_token")
                
                userinfo_res = await client.get(
                    "https://www.googleapis.com/oauth2/v3/userinfo",
                    headers={"Authorization": f"Bearer {access_token}"}
                )
                userinfo = userinfo_res.json()
                user_email = userinfo.get("email", "unknown@gmail.com")
                user_name = userinfo.get("name", user_email.split('@')[0])
        except Exception as e:
            logger.error(f"Google OAuth exchange failed: {e}", exc_info=True)
            raise HTTPException(status_code=400, detail=f"OAuth failure: {str(e)}")

    if allowed_emails_str:
        allowed_emails = [e.strip().lower() for e in allowed_emails_str.split(",") if e.strip()]
        if user_email.lower() not in allowed_emails:
            raise HTTPException(status_code=403, detail=f"Email {user_email} is not authorized to access this dashboard.")

    payload = {
        "email": user_email,
        "name": user_name,
        "provider": "google",
        "avatar": f"https://www.gravatar.com/avatar/{hashlib.md5(user_email.lower().encode()).hexdigest()}?d=mp"
    }
    jwt_token = create_jwt(payload)
    
    origin = request.cookies.get("sso_redirect_origin") or "/"
    if origin.endswith("/"):
        origin = origin[:-1]
        
    redirect_target = f"{origin}/"
    res_redirect = RedirectResponse(url=redirect_target)
    res_redirect.set_cookie(
        key="session_token",
        value=jwt_token,
        httponly=True,
        samesite="lax",
        max_age=30 * 24 * 3600
    )
    res_redirect.delete_cookie("sso_redirect_origin")
    return res_redirect

# Temple SSO endpoints removed

@app.post("/api/auth/login")
def login(payload: dict, response: Response):
    global dashboard_password
    if not dashboard_password or dashboard_password.strip() == "":
        return {"status": "success", "message": "Auth disabled"}
        
    user_password = payload.get("password")
    if user_password == dashboard_password:
        response.set_cookie(
            key="session_token",
            value=dashboard_password,
            httponly=True,
            samesite="lax",
            max_age=30 * 24 * 3600
        )
        return {"status": "success", "message": "Logged in successfully"}
    
    raise HTTPException(status_code=400, detail="Invalid password")

@app.post("/api/auth/logout")
def logout(response: Response):
    response.delete_cookie("session_token")
    return {"status": "success"}

@app.post("/api/auth/session")
def create_session(payload: dict, response: Response):
    global app_config, active_sessions
    email = payload.get("email")
    provider = payload.get("provider")
    if not email:
        raise HTTPException(status_code=400, detail="Missing email address")
        
    allowed_emails_str = ""
    if provider == "google" and app_config and app_config.google_sso:
        allowed_emails_str = app_config.google_sso.allowed_emails or os.environ.get("ALLOWED_EMAILS", "")
    elif provider == "microsoft" and app_config and app_config.microsoft_sso:
        allowed_emails_str = app_config.microsoft_sso.allowed_emails or os.environ.get("ALLOWED_EMAILS", "")
        
    if allowed_emails_str:
        allowed_emails = [e.strip().lower() for e in allowed_emails_str.split(",") if e.strip()]
        if email.lower() not in allowed_emails:
            raise HTTPException(status_code=403, detail=f"Email {email} is not authorized to access this dashboard.")
            
    import secrets
    session_token = secrets.token_hex(16)
    active_sessions.add(session_token)
    
    response.set_cookie(
        key="session_token",
        value=session_token,
        httponly=True,
        samesite="lax",
        max_age=30 * 24 * 3600
    )
    return {"status": "success", "message": "Session created successfully"}

# ── Microsoft SSO Endpoints ──

@app.get("/api/auth/microsoft/login")
def microsoft_login(request: Request):
    global app_config
    if not app_config or not app_config.microsoft_sso or not app_config.microsoft_sso.client_id:
        raise HTTPException(status_code=400, detail="Microsoft SSO is not configured on the server")
        
    state = secrets.token_hex(16)
    
    redirect_uri = app_config.microsoft_sso.redirect_uri
    if not redirect_uri:
        base_url = str(request.base_url).rstrip("/")
        redirect_uri = f"{base_url}/api/auth/microsoft/callback"
        
    # Check for mock mode
    if app_config.microsoft_sso.client_id == "mock":
        base_url = str(request.base_url).rstrip("/")
        url = f"{base_url}/api/auth/microsoft/mock-login?state={state}"
        response = RedirectResponse(url)
        response.set_cookie("oauth_state", state, httponly=True, max_age=600, samesite="lax")
        return response
        
    params = {
        "client_id": app_config.microsoft_sso.client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile User.Read",
        "state": state,
        "response_mode": "query"
    }
    url = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?" + urllib.parse.urlencode(params)
    
    response = RedirectResponse(url)
    response.set_cookie("oauth_state", state, httponly=True, max_age=600, samesite="lax")
    return response

@app.get("/api/auth/microsoft/callback")
async def microsoft_callback(request: Request, code: Optional[str] = None, state: Optional[str] = None, error: Optional[str] = None, email: Optional[str] = None, name: Optional[str] = None):
    global app_config
    if error:
        raise HTTPException(status_code=400, detail=f"Microsoft sign in failed: {error}")
    if not code:
        raise HTTPException(status_code=400, detail="Authorization code is missing")
        
    # Verify state
    cookie_state = request.cookies.get("oauth_state")
    if not state or state != cookie_state:
        raise HTTPException(status_code=400, detail="Invalid OAuth state")
        
    if not app_config or not app_config.microsoft_sso or not app_config.microsoft_sso.client_id:
        raise HTTPException(status_code=400, detail="Microsoft SSO is not configured")
        
    user_email = email or "test@gmail.com"
    user_name = name or "Test User"
    
    if app_config.microsoft_sso.client_id and app_config.microsoft_sso.client_secret and code != "mock_code":
        redirect_uri = app_config.microsoft_sso.redirect_uri
        if not redirect_uri:
            base_url = str(request.base_url).rstrip("/")
            redirect_uri = f"{base_url}/api/auth/microsoft/callback"
            
        # Exchange code for token
        token_url = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
        data = {
            "code": code,
            "client_id": app_config.microsoft_sso.client_id,
            "client_secret": app_config.microsoft_sso.client_secret,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code"
        }
        
        async with httpx.AsyncClient() as client:
            try:
                token_resp = await client.post(token_url, data=data)
                if token_resp.status_code != 200:
                    logger.error(f"Failed to exchange Microsoft code: {token_resp.text}")
                    raise HTTPException(status_code=400, detail="Failed to retrieve token from Microsoft")
                token_data = token_resp.json()
                access_token = token_data.get("access_token")
                
                # Fetch user info from Microsoft Graph API
                userinfo_url = "https://graph.microsoft.com/v1.0/me"
                userinfo_resp = await client.get(userinfo_url, headers={"Authorization": f"Bearer {access_token}"})
                if userinfo_resp.status_code != 200:
                    logger.error(f"Failed to fetch userinfo from Microsoft: {userinfo_resp.text}")
                    raise HTTPException(status_code=400, detail="Failed to retrieve user profile from Microsoft")
                
                user_data = userinfo_resp.json()
                # Microsoft user profile usually contains 'mail' or 'userPrincipalName'
                user_email = user_data.get("mail") or user_data.get("userPrincipalName")
                if not user_email:
                    raise HTTPException(status_code=400, detail="No email address associated with the Microsoft account")
                user_name = user_data.get("displayName") or user_email.split('@')[0]
                
            except HTTPException:
                raise
            except Exception as e:
                logger.error(f"Microsoft auth error: {e}", exc_info=True)
                raise HTTPException(status_code=500, detail=f"Internal authentication error: {str(e)}")

    # Verify if user email is allowed
    allowed_emails_str = app_config.microsoft_sso.allowed_emails or os.environ.get("ALLOWED_EMAILS", "")
    if allowed_emails_str:
        allowed_emails = [e.strip().lower() for e in allowed_emails_str.split(",") if e.strip()]
        if user_email.lower() not in allowed_emails:
            raise HTTPException(status_code=403, detail=f"Email {user_email} is not authorized to access this dashboard.")
    
    payload = {
        "email": user_email,
        "name": user_name,
        "provider": "microsoft",
        "avatar": f"https://www.gravatar.com/avatar/{hashlib.md5(user_email.lower().encode()).hexdigest()}?d=mp"
    }
    jwt_token = create_jwt(payload)
    
    response = RedirectResponse(url="/")
    response.set_cookie(
        key="session_token",
        value=jwt_token,
        httponly=True,
        samesite="lax",
        max_age=30 * 24 * 3600
    )
    response.delete_cookie("oauth_state")
    return response

@app.get("/api/auth/microsoft/mock-login", response_class=HTMLResponse)
def microsoft_mock_login(request: Request, state: str):
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <title>Microsoft Sign In (Simulated)</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body {{
                font-family: 'Segoe UI', -apple-system, system-ui, sans-serif;
                background-color: #f2f2f2;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                margin: 0;
            }}
            .card {{
                background: white;
                padding: 44px;
                box-shadow: 0 2px 6px rgba(0,0,0,0.2);
                width: 360px;
            }}
            .microsoft-logo {{
                display: flex;
                gap: 2px;
                margin-bottom: 20px;
            }}
            .microsoft-logo-grid {{
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 2px;
                width: 22px;
                height: 22px;
            }}
            .logo-box {{ width: 10px; height: 10px; }}
            .box-1 {{ background-color: #f25022; }}
            .box-2 {{ background-color: #7fba00; }}
            .box-3 {{ background-color: #00a4ef; }}
            .box-4 {{ background-color: #ffb900; }}
            .microsoft-text {{
                font-size: 16px;
                font-weight: 600;
                color: #737373;
                align-self: center;
                margin-left: 8px;
            }}
            h2 {{
                color: #1b1b1b;
                font-size: 24px;
                margin-top: 0;
                margin-bottom: 12px;
                font-weight: 600;
            }}
            .form-group {{
                margin-bottom: 20px;
            }}
            input {{
                width: 100%;
                padding: 8px 10px;
                border: 1px solid #7f7f7f;
                border-radius: 0px;
                box-sizing: border-box;
                font-size: 15px;
                outline: none;
            }}
            input:focus {{
                border-color: #0067b8;
            }}
            .buttons-container {{
                display: flex;
                justify-content: flex-end;
                gap: 12px;
            }}
            button {{
                background-color: #0067b8;
                color: white;
                border: none;
                padding: 6px 12px;
                font-size: 15px;
                cursor: pointer;
                min-width: 108px;
            }}
            button:hover {{
                background-color: #005da6;
            }}
        </style>
    </head>
    <body>
        <div class="card">
            <div class="microsoft-logo">
                <div class="microsoft-logo-grid">
                    <div class="logo-box box-1"></div>
                    <div class="logo-box box-2"></div>
                    <div class="logo-box box-3"></div>
                    <div class="logo-box box-4"></div>
                </div>
                <div class="microsoft-text">Microsoft</div>
            </div>
            <h2>Sign in</h2>
            <form action="/api/auth/microsoft/mock-callback" method="GET">
                <input type="hidden" name="state" value="{state}">
                <div class="form-group">
                    <input type="email" id="email" name="email" required placeholder="someone@example.com" autofocus>
                </div>
                <div class="buttons-container">
                    <button type="submit">Next</button>
                </div>
            </form>
        </div>
    </body>
    </html>
    """
    return HTMLResponse(content=html_content)

@app.get("/api/auth/microsoft/mock-callback")
def microsoft_mock_callback(request: Request, email: str, state: str):
    global app_config
    cookie_state = request.cookies.get("oauth_state")
    if not state or state != cookie_state:
        raise HTTPException(status_code=400, detail="Invalid OAuth state")
        
    allowed_emails_str = app_config.microsoft_sso.allowed_emails or os.environ.get("ALLOWED_EMAILS", "")
    if allowed_emails_str:
        allowed_emails = [e.strip().lower() for e in allowed_emails_str.split(",") if e.strip()]
        if email.lower() not in allowed_emails:
            raise HTTPException(status_code=403, detail=f"Email {email} is not authorized to access this dashboard.")
            
    payload = {
        "email": email,
        "name": email.split('@')[0],
        "provider": "microsoft",
        "avatar": f"https://www.gravatar.com/avatar/{hashlib.md5(email.lower().encode()).hexdigest()}?d=mp"
    }
    jwt_token = create_jwt(payload)
    
    response = RedirectResponse(url="/")
    response.set_cookie(
        key="session_token",
        value=jwt_token,
        httponly=True,
        samesite="lax",
        max_age=30 * 24 * 3600
    )
    response.delete_cookie("oauth_state")
    return response

@app.get("/api/status")
def get_status(request: Request):
    global dashboard_password, alpaca_service, pulse_url, active_sessions, app_config
    
    # Check if authorized
    google_enabled = bool(app_config and app_config.google_sso and app_config.google_sso.client_id)
    microsoft_enabled = bool(app_config and app_config.microsoft_sso and app_config.microsoft_sso.client_id)
    password_enabled = bool(dashboard_password and dashboard_password.strip() != "")
    
    auth_required = password_enabled or google_enabled or microsoft_enabled
    authorized = False
    user_info = None
    
    token = request.cookies.get("session_token")
    if not auth_required:
        authorized = True
    elif token == dashboard_password:
        authorized = True
        user_info = {"email": "admin@view", "name": "Admin User", "provider": "password"}
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

    pulse_online = False
    if pulse_url:
        import httpx
        try:
            response = httpx.get(pulse_url, timeout=1.0)
            if response.status_code == 200:
                pulse_online = True
        except Exception:
            pass

    return {
        "status": "online",
        "auth_enabled": auth_required,
        "authorized": authorized,
        "password_enabled": password_enabled,
        "google_enabled": google_enabled,
        "google_client_id": app_config.google_sso.client_id if (app_config and app_config.google_sso) else None,
        "microsoft_enabled": microsoft_enabled,
        "microsoft_client_id": app_config.microsoft_sso.client_id if (app_config and app_config.microsoft_sso) else None,
        "alpaca_mode": alpaca_service.is_paper if alpaca_service else "unknown",
        "pulse_url": pulse_url,
        "pulse_online": pulse_online,
        "user": user_info,
        "google_sso_configured": bool(GOOGLE_CLIENT_ID)
    }



# ── Owl Speaks Chat Proxy ──────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    message: str
    symbol: Optional[str] = None
    history: Optional[List[Dict[str, str]]] = None
    images: Optional[List[str]] = None

@app.post("/api/chat")
async def proxy_chat(payload: ChatRequest, request: Request):
    """Proxies chat request to the Owl Street Pulse backend, passing authorization cookie."""
    # Ensure authorized
    verify_dashboard_password(request)
    
    global pulse_url, dashboard_password
    if not pulse_url:
        raise HTTPException(status_code=503, detail="Pulse URL is not configured")
        
    url = f"{pulse_url.rstrip('/')}/api/chat"
    
    # Authenticate internal request using the dashboard password inside the session_token cookie
    cookies = {}
    if dashboard_password:
        cookies["session_token"] = dashboard_password
        
    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                url, 
                json=payload.model_dump(), 
                cookies=cookies,
                timeout=60.0
            )
            if response.status_code == 401:
                raise HTTPException(status_code=502, detail="Failed to authenticate backend call to Pulse")
            if response.status_code != 200:
                raise HTTPException(status_code=response.status_code, detail=response.text)
                
            return response.json()
        except httpx.RequestError as e:
            logger.error(f"Failed to reach Pulse backend for chat: {e}")
            raise HTTPException(status_code=503, detail="Owl Street Pulse alert system backend is currently offline")
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error in chat proxy: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=str(e))

# ── Trading & Account Routes (Protected) ───────────────────────────────────────

@app.get("/api/account", dependencies=[Depends(verify_dashboard_password)])
def get_account():
    try:
        return alpaca_service.get_account()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/clock", dependencies=[Depends(verify_dashboard_password)])
def get_clock():
    try:
        return alpaca_service.get_market_clock()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/positions", dependencies=[Depends(verify_dashboard_password)])
def get_positions():
    try:
        return alpaca_service.get_positions()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/positions/close", dependencies=[Depends(verify_dashboard_password)])
def close_position(body: ClosePositionBody):
    try:
        return alpaca_service.close_position(body.symbol, body.qty)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/orders", dependencies=[Depends(verify_dashboard_password)])
def get_orders(status: str = "open", limit: int = 100):
    try:
        return alpaca_service.get_orders(status, limit)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/orders/submit", dependencies=[Depends(verify_dashboard_password)])
def submit_advanced_order(body: AdvancedOrderBody):
    try:
        return alpaca_service.submit_advanced_order(body)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/orders/market", dependencies=[Depends(verify_dashboard_password)])
def place_market_order(body: MarketOrderBody):
    try:
        adv = AdvancedOrderBody(
            symbol=body.symbol,
            qty=body.qty,
            side=body.side,
            time_in_force=body.time_in_force,
            order_type="market",
        )
        return alpaca_service.submit_advanced_order(adv)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/orders/limit", dependencies=[Depends(verify_dashboard_password)])
def place_limit_order(body: LimitOrderBody):
    try:
        adv = AdvancedOrderBody(
            symbol=body.symbol,
            qty=body.qty,
            side=body.side,
            time_in_force=body.time_in_force,
            order_type="limit",
            limit_price=body.limit_price,
        )
        return alpaca_service.submit_advanced_order(adv)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/orders/{order_id}", dependencies=[Depends(verify_dashboard_password)])
def get_order_detail(order_id: str, nested: bool = True):
    try:
        return alpaca_service.get_order_detail(order_id, nested)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.patch("/api/orders/{order_id}", dependencies=[Depends(verify_dashboard_password)])
def replace_order(order_id: str, body: ReplaceOrderBody):
    try:
        return alpaca_service.replace_order(order_id, body)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.delete("/api/orders/{order_id}", dependencies=[Depends(verify_dashboard_password)])
def cancel_order(order_id: str):
    try:
        return alpaca_service.cancel_order(order_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# ── Market Data Routes (Protected) ─────────────────────────────────────────────

@app.get("/api/quote/{symbol}", dependencies=[Depends(verify_dashboard_password)])
def get_quote(symbol: str):
    try:
        return alpaca_service.get_quote(symbol)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/snapshot/{symbol}", dependencies=[Depends(verify_dashboard_password)])
def get_snapshot(symbol: str):
    try:
        return alpaca_service.get_snapshot(symbol)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/bars/{symbol}", dependencies=[Depends(verify_dashboard_password)])
def get_bars(symbol: str, timeframe: str = "1D", start: Optional[str] = None, end: Optional[str] = None, limit: Optional[int] = None):
    try:
        return alpaca_service.get_bars(symbol, timeframe, start, end, limit)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/option-expirations/{underlying}", dependencies=[Depends(verify_dashboard_password)])
def get_option_expirations(underlying: str, horizon_days: int = 548):
    try:
        return alpaca_service.get_option_expirations(underlying, horizon_days)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/option-chain/{underlying}", dependencies=[Depends(verify_dashboard_password)])
def get_option_chain(underlying: str, expiration_date: Optional[str] = None, contract_type: Optional[str] = None, limit: int = 80):
    try:
        return alpaca_service.get_option_chain(underlying, expiration_date, contract_type, limit)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/option-chain-matrix/{underlying}", dependencies=[Depends(verify_dashboard_password)])
def get_option_chain_matrix(underlying: str, expiration_date: str, wing: int = 32, center_strike: Optional[float] = None):
    try:
        return alpaca_service.get_option_chain_matrix(underlying, expiration_date, wing, center_strike)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/screener", dependencies=[Depends(verify_dashboard_password)])
def run_screener(body: ScreenerRequest):
    try:
        return alpaca_service.run_screener(body)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# ── WebSocket live quotes ─────────────────────────────────────────────────────

@app.websocket("/ws/quotes")
async def websocket_quotes(websocket: WebSocket):
    global alpaca_service
    await websocket.accept()
    
    if not alpaca_service:
        await websocket.close(code=1008, reason="Alpaca Service not initialized")
        return
        
    stock_stream: Optional[StockDataStream] = None
    option_stream: Optional[OptionDataStream] = None
    stock_task: Optional[asyncio.Task] = None
    option_task: Optional[asyncio.Task] = None

    async def handle_quote(quote):
        msg = {
            "symbol": quote.symbol,
            "ask_price": float(quote.ask_price),
            "bid_price": float(quote.bid_price),
            "timestamp": quote.timestamp.isoformat(),
        }
        try:
            await websocket.send_text(json.dumps(msg))
        except Exception:
            pass

    def subscribe_partitioned(symbols: list[str]) -> None:
        nonlocal stock_stream, option_stream, stock_task, option_task
        stocks = [s for s in symbols if not is_option_symbol(s)]
        opts = [s for s in symbols if is_option_symbol(s)]
        
        if stocks:
            if stock_stream is None:
                stock_stream = StockDataStream(alpaca_service.api_key, alpaca_service.secret_key)
                stock_stream.subscribe_quotes(handle_quote, *stocks)
                stock_task = asyncio.create_task(stock_stream.run())
            else:
                stock_stream.subscribe_quotes(handle_quote, *stocks)
        if opts:
            if option_stream is None:
                option_stream = OptionDataStream(alpaca_service.api_key, alpaca_service.secret_key)
                option_stream.subscribe_quotes(handle_quote, *opts)
                option_task = asyncio.create_task(option_stream.run())
            else:
                option_stream.subscribe_quotes(handle_quote, *opts)

    try:
        # Initial subscription
        data = await asyncio.wait_for(websocket.receive_text(), timeout=30)
        msg = json.loads(data)
        if msg.get("action") == "subscribe" and msg.get("symbols"):
            subscribe_partitioned([s.upper() for s in msg["symbols"]])
            
            # Keep receiving additional subscriptions
            while True:
                raw = await websocket.receive_text()
                update = json.loads(raw)
                if update.get("action") == "subscribe":
                    new_syms = [s.upper() for s in update.get("symbols", [])]
                    if new_syms:
                        subscribe_partitioned(new_syms)
    except (WebSocketDisconnect, asyncio.TimeoutError):
        pass
    finally:
        for stream in (stock_stream, option_stream):
            if stream is not None:
                try:
                    stream.stop()
                except Exception:
                    pass
        for task in (stock_task, option_task):
            if task is not None:
                task.cancel()

# ── Serve React Static Assets ────────────────────────────────────────────────

frontend_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend", "build")
if os.path.exists(frontend_dir):
    logger.info(f"Serving frontend static build from: {frontend_dir}")
    
    # Mount static assets directory
    static_assets_path = os.path.join(frontend_dir, "static")
    if os.path.exists(static_assets_path):
        app.mount("/static", StaticFiles(directory=static_assets_path), name="static")
    
    # Fallback to index.html for client side routing
    @app.get("/{full_path:path}", response_class=HTMLResponse)
    def serve_frontend(full_path: str):
        if full_path.startswith("api") or full_path.startswith("ws"):
            raise HTTPException(status_code=404)
        index_file = os.path.join(frontend_dir, "index.html")
        if os.path.exists(index_file):
            with open(index_file, "r") as f:
                return HTMLResponse(content=f.read())
        return HTMLResponse(content="<h1>Frontend index.html not found!</h1>", status_code=404)
else:
    logger.warning("Frontend build directory 'frontend/build' not found. App will run in API-only mode.")

    @app.get("/", response_class=HTMLResponse)
    def root_landing():
        return HTMLResponse(content="""
        <!DOCTYPE html>
        <html>
        <head>
            <title>Owl Street View API</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0b0f19; color: #f8fafc; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
                .card { background: #1e293b; border: 1px solid #334155; padding: 32px; border-radius: 12px; max-width: 500px; width: 90%; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
                h1 { color: #38bdf8; margin-top: 0; font-size: 24px; }
                p { color: #94a3b8; line-height: 1.6; }
                a { color: #38bdf8; text-decoration: none; font-weight: 600; }
                a:hover { text-decoration: underline; }
                .endpoint { background: #0f172a; padding: 10px 14px; border-radius: 6px; border: 1px solid #1e293b; margin-top: 12px; font-family: monospace; font-size: 14px; }
            </style>
        </head>
        <body>
            <div class="card">
                <h1>🦉 Owl Street View API Online</h1>
                <p>The Python FastAPI backend service is running successfully on Vercel Serverless.</p>
                <div class="endpoint">
                    GET <a href="/api/status">/api/status</a> — Read System Status
                </div>
            </div>
        </body>
        </html>
        """)
