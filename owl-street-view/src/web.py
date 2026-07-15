import os
import json
import logging
import asyncio
from typing import Optional, Dict, List, Any
from fastapi import FastAPI, Request, Response, HTTPException, Depends, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
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

# Dependency to check password auth cookie or SSO session token
def verify_dashboard_password(request: Request):
    global dashboard_password, active_sessions, app_config
    
    # Check if authentication is enabled overall
    google_enabled = bool(app_config and app_config.google_sso and app_config.google_sso.client_id)
    temple_enabled = bool(app_config and app_config.temple_sso and app_config.temple_sso.client_id)
    password_enabled = bool(dashboard_password and dashboard_password.strip() != "")
    
    if not (password_enabled or google_enabled or temple_enabled):
        return True
        
    token = request.cookies.get("session_token")
    if not token:
        raise HTTPException(status_code=401, detail="Unauthorized")
        
    if password_enabled and token == dashboard_password:
        return True
        
    if token in active_sessions:
        return True
        
    raise HTTPException(status_code=401, detail="Unauthorized")

@app.on_event("startup")
def startup_event():
    config_path = os.environ.get("WEB_CONFIG_PATH", "config/config.yaml")
    if not os.path.exists(config_path):
        logger.warning(f"Config file not found at '{config_path}'. Running without Alpaca Client initialized.")
        return
    try:
        from src.config import load_config
        config = load_config(config_path)
        init_web_service(config)
        logger.info(f"Loaded config from '{config_path}' and initialized Alpaca Service.")
    except Exception as e:
        logger.error(f"Error loading configuration during startup: {e}", exc_info=True)

def init_web_service(config: AppConfig):
    global alpaca_service, dashboard_password, pulse_url, app_config
    app_config = config
    dashboard_password = config.dashboard_password
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
    global dashboard_password, active_sessions, app_config
    
    google_enabled = bool(app_config and app_config.google_sso and app_config.google_sso.client_id)
    temple_enabled = bool(app_config and app_config.temple_sso and app_config.temple_sso.client_id)
    password_enabled = bool(dashboard_password and dashboard_password.strip() != "")
    
    auth_enabled = password_enabled or google_enabled or temple_enabled
    
    authorized = False
    if not auth_enabled:
        authorized = True
    else:
        token = request.cookies.get("session_token")
        if token:
            if password_enabled and token == dashboard_password:
                authorized = True
            elif token in active_sessions:
                authorized = True
                
    return {
        "auth_enabled": auth_enabled,
        "authorized": authorized,
        "password_enabled": password_enabled,
        "google_enabled": google_enabled,
        "temple_enabled": temple_enabled
    }

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
            max_age=30 * 24 * 3600  # 30 days
        )
        return {"status": "success", "message": "Logged in successfully"}
    
    raise HTTPException(status_code=400, detail="Invalid password")

@app.post("/api/auth/logout")
def logout(response: Response):
    response.delete_cookie("session_token")
    return {"status": "success"}

# ── Google SSO Endpoints ──

@app.get("/api/auth/google/login")
def google_login(request: Request):
    global app_config
    if not app_config or not app_config.google_sso or not app_config.google_sso.client_id:
        raise HTTPException(status_code=400, detail="Google SSO is not configured on the server")
        
    state = secrets.token_hex(16)
    
    redirect_uri = app_config.google_sso.redirect_uri
    if not redirect_uri:
        base_url = str(request.base_url).rstrip("/")
        redirect_uri = f"{base_url}/api/auth/google/callback"
        
    # Check for mock mode
    if app_config.google_sso.client_id == "mock":
        base_url = str(request.base_url).rstrip("/")
        url = f"{base_url}/api/auth/google/mock-login?state={state}"
        response = RedirectResponse(url)
        response.set_cookie("oauth_state", state, httponly=True, max_age=600, samesite="lax")
        return response
        
    params = {
        "client_id": app_config.google_sso.client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "prompt": "select_account"
    }
    url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode(params)
    
    response = RedirectResponse(url)
    response.set_cookie("oauth_state", state, httponly=True, max_age=600, samesite="lax")
    return response

@app.get("/api/auth/google/callback")
async def google_callback(request: Request, code: Optional[str] = None, state: Optional[str] = None, error: Optional[str] = None):
    global app_config, active_sessions
    if error:
        raise HTTPException(status_code=400, detail=f"Google sign in failed: {error}")
    if not code:
        raise HTTPException(status_code=400, detail="Authorization code is missing")
        
    # Verify state
    cookie_state = request.cookies.get("oauth_state")
    if not state or state != cookie_state:
        raise HTTPException(status_code=400, detail="Invalid OAuth state")
        
    if not app_config or not app_config.google_sso or not app_config.google_sso.client_id:
        raise HTTPException(status_code=400, detail="Google SSO is not configured")
        
    redirect_uri = app_config.google_sso.redirect_uri
    if not redirect_uri:
        base_url = str(request.base_url).rstrip("/")
        redirect_uri = f"{base_url}/api/auth/google/callback"
        
    # Exchange code for token
    token_url = "https://oauth2.googleapis.com/token"
    data = {
        "code": code,
        "client_id": app_config.google_sso.client_id,
        "client_secret": app_config.google_sso.client_secret,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code"
    }
    
    async with httpx.AsyncClient() as client:
        try:
            token_resp = await client.post(token_url, data=data)
            if token_resp.status_code != 200:
                logger.error(f"Failed to exchange Google code: {token_resp.text}")
                raise HTTPException(status_code=400, detail="Failed to retrieve token from Google")
            token_data = token_resp.json()
            access_token = token_data.get("access_token")
            
            # Fetch userinfo
            userinfo_url = "https://www.googleapis.com/oauth2/v3/userinfo"
            userinfo_resp = await client.get(userinfo_url, headers={"Authorization": f"Bearer {access_token}"})
            if userinfo_resp.status_code != 200:
                logger.error(f"Failed to fetch userinfo from Google: {userinfo_resp.text}")
                raise HTTPException(status_code=400, detail="Failed to retrieve user profile from Google")
            
            user_data = userinfo_resp.json()
            email = user_data.get("email")
            if not email:
                raise HTTPException(status_code=400, detail="No email address associated with the Google account")
                
            # Verify if user email is allowed
            allowed_emails_str = app_config.google_sso.allowed_emails or os.environ.get("ALLOWED_EMAILS", "")
            if allowed_emails_str:
                allowed_emails = [e.strip().lower() for e in allowed_emails_str.split(",") if e.strip()]
                if email.lower() not in allowed_emails:
                    raise HTTPException(status_code=403, detail=f"Email {email} is not authorized to access this dashboard.")
            
            # Login successful: create session
            session_token = secrets.token_hex(16)
            active_sessions.add(session_token)
            
            response = RedirectResponse(url="/")
            response.set_cookie(
                key="session_token",
                value=session_token,
                httponly=True,
                samesite="lax",
                max_age=30 * 24 * 3600
            )
            response.delete_cookie("oauth_state")
            return response
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Google auth error: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Internal authentication error: {str(e)}")

@app.get("/api/auth/google/mock-login", response_class=HTMLResponse)
def google_mock_login(request: Request, state: str):
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <title>Google Sign In (Simulated)</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body {{
                font-family: 'Roboto', -apple-system, system-ui, sans-serif;
                background-color: #f0f2f5;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                margin: 0;
            }}
            .card {{
                background: white;
                padding: 40px;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.1);
                width: 360px;
                text-align: center;
            }}
            .google-logo {{
                font-size: 24px;
                font-weight: bold;
                margin-bottom: 20px;
            }}
            .google-logo span:nth-child(1) {{ color: #4285F4; }}
            .google-logo span:nth-child(2) {{ color: #EA4335; }}
            .google-logo span:nth-child(3) {{ color: #FBBC05; }}
            .google-logo span:nth-child(4) {{ color: #34A853; }}
            h2 {{
                color: #202124;
                font-size: 22px;
                margin-bottom: 8px;
                font-weight: 400;
            }}
            p {{
                color: #5f6368;
                font-size: 14px;
                margin-bottom: 24px;
            }}
            .form-group {{
                margin-bottom: 20px;
                text-align: left;
            }}
            label {{
                display: block;
                font-size: 13px;
                color: #5f6368;
                margin-bottom: 6px;
            }}
            input {{
                width: 100%;
                padding: 10px 12px;
                border: 1px solid #dadce0;
                border-radius: 4px;
                box-sizing: border-box;
                font-size: 14px;
                outline: none;
            }}
            input:focus {{
                border-color: #4285F4;
            }}
            button {{
                width: 100%;
                background-color: #1a73e8;
                color: white;
                border: none;
                padding: 10px;
                border-radius: 4px;
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                transition: background-color 0.2s;
            }}
            button:hover {{
                background-color: #1557b0;
            }}
        </style>
    </head>
    <body>
        <div class="card">
            <div class="google-logo">
                <span>G</span><span>o</span><span>o</span><span>g</span><span>l</span><span>e</span>
            </div>
            <h2>Sign in</h2>
            <p>to continue to Owl Street Dashboard</p>
            <form action="/api/auth/google/mock-callback" method="GET">
                <input type="hidden" name="state" value="{state}">
                <div class="form-group">
                    <label for="email">Email address</label>
                    <input type="email" id="email" name="email" required placeholder="user@gmail.com" autofocus>
                </div>
                <button type="submit">Next</button>
            </form>
        </div>
    </body>
    </html>
    """
    return HTMLResponse(content=html_content)

@app.get("/api/auth/google/mock-callback")
def google_mock_callback(request: Request, email: str, state: str):
    global app_config, active_sessions
    cookie_state = request.cookies.get("oauth_state")
    if not state or state != cookie_state:
        raise HTTPException(status_code=400, detail="Invalid OAuth state")
        
    allowed_emails_str = app_config.google_sso.allowed_emails or os.environ.get("ALLOWED_EMAILS", "")
    if allowed_emails_str:
        allowed_emails = [e.strip().lower() for e in allowed_emails_str.split(",") if e.strip()]
        if email.lower() not in allowed_emails:
            raise HTTPException(status_code=403, detail=f"Email {email} is not authorized to access this dashboard.")
            
    session_token = secrets.token_hex(16)
    active_sessions.add(session_token)
    
    response = RedirectResponse(url="/")
    response.set_cookie(
        key="session_token",
        value=session_token,
        httponly=True,
        samesite="lax",
        max_age=30 * 24 * 3600
    )
    response.delete_cookie("oauth_state")
    return response

# ── Temple SSO Endpoints ──

@app.get("/api/auth/temple/login")
def temple_login(request: Request):
    global app_config
    if not app_config or not app_config.temple_sso or not app_config.temple_sso.client_id:
        raise HTTPException(status_code=400, detail="Temple SSO is not configured on the server")
        
    state = secrets.token_hex(16)
    
    redirect_uri = app_config.temple_sso.redirect_uri
    if not redirect_uri:
        base_url = str(request.base_url).rstrip("/")
        redirect_uri = f"{base_url}/api/auth/temple/callback"
        
    # Check for mock mode
    if app_config.temple_sso.client_id == "mock":
        base_url = str(request.base_url).rstrip("/")
        url = f"{base_url}/api/auth/temple/mock-login?state={state}"
        response = RedirectResponse(url)
        response.set_cookie("oauth_state", state, httponly=True, max_age=600, samesite="lax")
        return response
        
    params = {
        "client_id": app_config.temple_sso.client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state
    }
    url = app_config.temple_sso.auth_url + "?" + urllib.parse.urlencode(params)
    
    response = RedirectResponse(url)
    response.set_cookie("oauth_state", state, httponly=True, max_age=600, samesite="lax")
    return response

@app.get("/api/auth/temple/callback")
async def temple_callback(request: Request, code: Optional[str] = None, state: Optional[str] = None, error: Optional[str] = None):
    global app_config, active_sessions
    if error:
        raise HTTPException(status_code=400, detail=f"Temple sign in failed: {error}")
    if not code:
        raise HTTPException(status_code=400, detail="Authorization code is missing")
        
    # Verify state
    cookie_state = request.cookies.get("oauth_state")
    if not state or state != cookie_state:
        raise HTTPException(status_code=400, detail="Invalid OAuth state")
        
    if not app_config or not app_config.temple_sso or not app_config.temple_sso.client_id:
        raise HTTPException(status_code=400, detail="Temple SSO is not configured")
        
    redirect_uri = app_config.temple_sso.redirect_uri
    if not redirect_uri:
        base_url = str(request.base_url).rstrip("/")
        redirect_uri = f"{base_url}/api/auth/temple/callback"
        
    # Exchange code for token
    token_url = app_config.temple_sso.token_url
    data = {
        "code": code,
        "client_id": app_config.temple_sso.client_id,
        "client_secret": app_config.temple_sso.client_secret,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code"
    }
    
    async with httpx.AsyncClient() as client:
        try:
            token_resp = await client.post(token_url, data=data)
            if token_resp.status_code != 200:
                logger.error(f"Failed to exchange Temple code: {token_resp.text}")
                raise HTTPException(status_code=400, detail="Failed to retrieve token from Temple")
            token_data = token_resp.json()
            access_token = token_data.get("access_token")
            
            # Fetch userinfo
            userinfo_url = app_config.temple_sso.userinfo_url
            userinfo_resp = await client.get(userinfo_url, headers={"Authorization": f"Bearer {access_token}"})
            if userinfo_resp.status_code != 200:
                logger.error(f"Failed to fetch userinfo from Temple: {userinfo_resp.text}")
                raise HTTPException(status_code=400, detail="Failed to retrieve user profile from Temple")
            
            user_data = userinfo_resp.json()
            email = user_data.get("email") or user_data.get("upn") or user_data.get("sub")
            if not email:
                raise HTTPException(status_code=400, detail="No identifier associated with the Temple account")
                
            # Verify if user email is allowed
            allowed_emails_str = app_config.google_sso.allowed_emails or os.environ.get("ALLOWED_EMAILS", "")
            if allowed_emails_str:
                allowed_emails = [e.strip().lower() for e in allowed_emails_str.split(",") if e.strip()]
                if email.lower() not in allowed_emails and (f"{email.lower()}@temple.edu" not in allowed_emails):
                    raise HTTPException(status_code=403, detail=f"User {email} is not authorized to access this dashboard.")
            
            # Login successful: create session
            session_token = secrets.token_hex(16)
            active_sessions.add(session_token)
            
            response = RedirectResponse(url="/")
            response.set_cookie(
                key="session_token",
                value=session_token,
                httponly=True,
                samesite="lax",
                max_age=30 * 24 * 3600
            )
            response.delete_cookie("oauth_state")
            return response
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Temple auth error: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Internal authentication error: {str(e)}")

@app.get("/api/auth/temple/mock-login", response_class=HTMLResponse)
def temple_mock_login(request: Request, state: str):
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <title>Temple University SSO (Simulated)</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body {{
                font-family: 'Outfit', 'Inter', -apple-system, sans-serif;
                background-color: #0b0f19;
                color: #fff;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                margin: 0;
            }}
            .card {{
                background: rgba(17, 24, 39, 0.85);
                backdrop-filter: blur(20px);
                border: 1px solid rgba(255, 255, 255, 0.06);
                border-radius: 20px;
                padding: 40px;
                box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
                width: 360px;
                text-align: center;
            }}
            .temple-header {{
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 12px;
                margin-bottom: 24px;
            }}
            .temple-logo {{
                width: 36px;
                height: 36px;
                background: #9e1b34; /* Official Temple Cherry */
                border-radius: 8px;
                font-size: 20px;
                font-weight: bold;
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
            }}
            .title {{
                font-size: 20px;
                font-weight: 700;
                background: linear-gradient(135deg, #fff, #9ca3af);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }}
            h2 {{
                font-size: 18px;
                font-weight: 500;
                margin: 0 0 8px 0;
            }}
            p {{
                color: #9ca3af;
                font-size: 13px;
                margin: 0 0 24px 0;
            }}
            .form-group {{
                margin-bottom: 20px;
                text-align: left;
            }}
            label {{
                display: block;
                font-size: 12px;
                color: #9ca3af;
                margin-bottom: 6px;
                font-weight: 500;
            }}
            input {{
                width: 100%;
                background: rgba(0, 0, 0, 0.2);
                border: 1px solid rgba(255, 255, 255, 0.06);
                border-radius: 10px;
                padding: 12px;
                box-sizing: border-box;
                color: white;
                font-size: 14px;
                outline: none;
            }}
            input:focus {{
                border-color: #9e1b34;
            }}
            button {{
                width: 100%;
                background: #9e1b34;
                color: white;
                border: none;
                padding: 12px;
                border-radius: 10px;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s;
                box-shadow: 0 4px 14px rgba(158, 27, 52, 0.25);
            }}
            button:hover {{
                background: #bd213e;
                transform: translateY(-1px);
            }}
        </style>
    </head>
    <body>
        <div class="card">
            <div class="temple-header">
                <div class="temple-logo">T</div>
                <div class="title">Temple University</div>
            </div>
            <h2>AccessNet Login</h2>
            <p>Sign in using your Temple credentials</p>
            <form action="/api/auth/temple/mock-callback" method="GET">
                <input type="hidden" name="state" value="{state}">
                <div class="form-group">
                    <label for="username">AccessNet ID or Email</label>
                    <input type="text" id="username" name="username" required placeholder="tux12345 or user@temple.edu" autofocus>
                </div>
                <button type="submit">Sign In</button>
            </form>
        </div>
    </body>
    </html>
    """
    return HTMLResponse(content=html_content)

@app.get("/api/auth/temple/mock-callback")
def temple_mock_callback(request: Request, username: str, state: str):
    global app_config, active_sessions
    cookie_state = request.cookies.get("oauth_state")
    if not state or state != cookie_state:
        raise HTTPException(status_code=400, detail="Invalid OAuth state")
        
    email = username
    if "@" not in email:
        email = f"{username}@temple.edu"
        
    # Verify if user email is allowed
    allowed_emails_str = app_config.google_sso.allowed_emails or os.environ.get("ALLOWED_EMAILS", "")
    if allowed_emails_str:
        allowed_emails = [e.strip().lower() for e in allowed_emails_str.split(",") if e.strip()]
        if email.lower() not in allowed_emails and username.lower() not in allowed_emails:
            raise HTTPException(status_code=403, detail=f"User {email} is not authorized to access this dashboard.")
            
    session_token = secrets.token_hex(16)
    active_sessions.add(session_token)
    
    response = RedirectResponse(url="/")
    response.set_cookie(
        key="session_token",
        value=session_token,
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
    temple_enabled = bool(app_config and app_config.temple_sso and app_config.temple_sso.client_id)
    password_enabled = bool(dashboard_password and dashboard_password.strip() != "")
    
    auth_required = password_enabled or google_enabled or temple_enabled
    authorized = False
    
    if auth_required:
        token = request.cookies.get("session_token")
        if token:
            if password_enabled and token == dashboard_password:
                authorized = True
            elif token in active_sessions:
                authorized = True
    else:
        authorized = True

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
        "temple_enabled": temple_enabled,
        "alpaca_mode": alpaca_service.is_paper if alpaca_service else "unknown",
        "pulse_url": pulse_url,
        "pulse_online": pulse_online
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
