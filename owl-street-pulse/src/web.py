import os
import time
import logging
import threading
from datetime import datetime, timezone
from typing import Dict, Any, Optional, List
from fastapi import FastAPI, Request, Response, HTTPException, Depends
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

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
app = FastAPI(title="Owl Street Pulse API", version="1.0.0")

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

active_sessions = set()

# Authentication dependency
def verify_dashboard_password(request: Request):
    global active_sessions
    password = os.environ.get("DASHBOARD_PASSWORD")
    
    try:
        config = load_config(CONFIG_PATH)
        google_enabled = bool(config.google_sso and config.google_sso.client_id)
        temple_enabled = bool(config.temple_sso and config.temple_sso.client_id)
    except Exception:
        google_enabled = False
        temple_enabled = False
        
    password_enabled = bool(password and password.strip() != "")
    
    if not (password_enabled or google_enabled or temple_enabled):
        return True  # Auth is disabled if none are set
        
    token = request.cookies.get("session_token")
    if not token:
        raise HTTPException(status_code=401, detail="Unauthorized")
        
    if password_enabled and token == password:
        return True
    if token in active_sessions:
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
    global active_sessions
    password = os.environ.get("DASHBOARD_PASSWORD")
    
    try:
        config = load_config(CONFIG_PATH)
        google_enabled = bool(config.google_sso and config.google_sso.client_id)
        temple_enabled = bool(config.temple_sso and config.temple_sso.client_id)
    except Exception:
        google_enabled = False
        temple_enabled = False
        
    password_enabled = bool(password and password.strip() != "")
    auth_enabled = password_enabled or google_enabled or temple_enabled
    
    authorized = False
    if not auth_enabled:
        authorized = True
    else:
        token = request.cookies.get("session_token")
        if token:
            if password_enabled and token == password:
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
    """Authenticates user and sets session cookie."""
    password = os.environ.get("DASHBOARD_PASSWORD")
    if not password:
        return {"status": "success", "message": "Auth disabled"}
        
    user_password = payload.get("password")
    if user_password == password:
        response.set_cookie(
            key="session_token",
            value=password,
            httponly=True,
            samesite="lax",
            max_age=30 * 24 * 3600  # 30 days
        )
        return {"status": "success", "message": "Logged in successfully"}
    
    raise HTTPException(status_code=400, detail="Invalid password")

@app.post("/api/auth/logout")
def logout(response: Response):
    """Logs out the user by deleting cookie."""
    response.delete_cookie("session_token")
    return {"status": "success"}

# ── Google SSO Endpoints ──

@app.get("/api/auth/google/login")
def google_login(request: Request):
    try:
        config = load_config(CONFIG_PATH)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load config: {e}")
        
    if not config.google_sso or not config.google_sso.client_id:
        raise HTTPException(status_code=400, detail="Google SSO is not configured on the server")
        
    state = secrets.token_hex(16)
    
    redirect_uri = config.google_sso.redirect_uri
    if not redirect_uri:
        base_url = str(request.base_url).rstrip("/")
        redirect_uri = f"{base_url}/api/auth/google/callback"
        
    if config.google_sso.client_id == "mock":
        base_url = str(request.base_url).rstrip("/")
        url = f"{base_url}/api/auth/google/mock-login?state={state}"
        response = RedirectResponse(url)
        response.set_cookie("oauth_state", state, httponly=True, max_age=600, samesite="lax")
        return response
        
    params = {
        "client_id": config.google_sso.client_id,
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
    global active_sessions
    if error:
        raise HTTPException(status_code=400, detail=f"Google sign in failed: {error}")
    if not code:
        raise HTTPException(status_code=400, detail="Authorization code is missing")
        
    cookie_state = request.cookies.get("oauth_state")
    if not state or state != cookie_state:
        raise HTTPException(status_code=400, detail="Invalid OAuth state")
        
    try:
        config = load_config(CONFIG_PATH)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load config: {e}")
        
    if not config.google_sso or not config.google_sso.client_id:
        raise HTTPException(status_code=400, detail="Google SSO is not configured")
        
    redirect_uri = config.google_sso.redirect_uri
    if not redirect_uri:
        base_url = str(request.base_url).rstrip("/")
        redirect_uri = f"{base_url}/api/auth/google/callback"
        
    token_url = "https://oauth2.googleapis.com/token"
    data = {
        "code": code,
        "client_id": config.google_sso.client_id,
        "client_secret": config.google_sso.client_secret,
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
            
            userinfo_url = "https://www.googleapis.com/oauth2/v3/userinfo"
            userinfo_resp = await client.get(userinfo_url, headers={"Authorization": f"Bearer {access_token}"})
            if userinfo_resp.status_code != 200:
                logger.error(f"Failed to fetch userinfo from Google: {userinfo_resp.text}")
                raise HTTPException(status_code=400, detail="Failed to retrieve user profile from Google")
            
            user_data = userinfo_resp.json()
            email = user_data.get("email")
            if not email:
                raise HTTPException(status_code=400, detail="No email address associated with the Google account")
                
            allowed_emails_str = config.google_sso.allowed_emails or os.environ.get("ALLOWED_EMAILS", "")
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
    global active_sessions
    cookie_state = request.cookies.get("oauth_state")
    if not state or state != cookie_state:
        raise HTTPException(status_code=400, detail="Invalid OAuth state")
        
    try:
        config = load_config(CONFIG_PATH)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load config: {e}")
        
    allowed_emails_str = config.google_sso.allowed_emails or os.environ.get("ALLOWED_EMAILS", "")
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
    try:
        config = load_config(CONFIG_PATH)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load config: {e}")
        
    if not config.temple_sso or not config.temple_sso.client_id:
        raise HTTPException(status_code=400, detail="Temple SSO is not configured on the server")
        
    state = secrets.token_hex(16)
    
    redirect_uri = config.temple_sso.redirect_uri
    if not redirect_uri:
        base_url = str(request.base_url).rstrip("/")
        redirect_uri = f"{base_url}/api/auth/temple/callback"
        
    if config.temple_sso.client_id == "mock":
        base_url = str(request.base_url).rstrip("/")
        url = f"{base_url}/api/auth/temple/mock-login?state={state}"
        response = RedirectResponse(url)
        response.set_cookie("oauth_state", state, httponly=True, max_age=600, samesite="lax")
        return response
        
    params = {
        "client_id": config.temple_sso.client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state
    }
    url = config.temple_sso.auth_url + "?" + urllib.parse.urlencode(params)
    
    response = RedirectResponse(url)
    response.set_cookie("oauth_state", state, httponly=True, max_age=600, samesite="lax")
    return response

@app.get("/api/auth/temple/callback")
async def temple_callback(request: Request, code: Optional[str] = None, state: Optional[str] = None, error: Optional[str] = None):
    global active_sessions
    if error:
        raise HTTPException(status_code=400, detail=f"Temple sign in failed: {error}")
    if not code:
        raise HTTPException(status_code=400, detail="Authorization code is missing")
        
    cookie_state = request.cookies.get("oauth_state")
    if not state or state != cookie_state:
        raise HTTPException(status_code=400, detail="Invalid OAuth state")
        
    try:
        config = load_config(CONFIG_PATH)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load config: {e}")
        
    if not config.temple_sso or not config.temple_sso.client_id:
        raise HTTPException(status_code=400, detail="Temple SSO is not configured")
        
    redirect_uri = config.temple_sso.redirect_uri
    if not redirect_uri:
        base_url = str(request.base_url).rstrip("/")
        redirect_uri = f"{base_url}/api/auth/temple/callback"
        
    token_url = config.temple_sso.token_url
    data = {
        "code": code,
        "client_id": config.temple_sso.client_id,
        "client_secret": config.temple_sso.client_secret,
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
            
            userinfo_url = config.temple_sso.userinfo_url
            userinfo_resp = await client.get(userinfo_url, headers={"Authorization": f"Bearer {access_token}"})
            if userinfo_resp.status_code != 200:
                logger.error(f"Failed to fetch userinfo from Temple: {userinfo_resp.text}")
                raise HTTPException(status_code=400, detail="Failed to retrieve user profile from Temple")
            
            user_data = userinfo_resp.json()
            email = user_data.get("email") or user_data.get("upn") or user_data.get("sub")
            if not email:
                raise HTTPException(status_code=400, detail="No identifier associated with the Temple account")
                
            allowed_emails_str = config.google_sso.allowed_emails or os.environ.get("ALLOWED_EMAILS", "")
            if allowed_emails_str:
                allowed_emails = [e.strip().lower() for e in allowed_emails_str.split(",") if e.strip()]
                if email.lower() not in allowed_emails and (f"{email.lower()}@temple.edu" not in allowed_emails):
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
    global active_sessions
    cookie_state = request.cookies.get("oauth_state")
    if not state or state != cookie_state:
        raise HTTPException(status_code=400, detail="Invalid OAuth state")
        
    email = username
    if "@" not in email:
        email = f"{username}@temple.edu"
        
    try:
        config = load_config(CONFIG_PATH)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load config: {e}")
        
    # Verify if user email is allowed
    allowed_emails_str = config.google_sso.allowed_emails or os.environ.get("ALLOWED_EMAILS", "")
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

@app.get("/api/status", dependencies=[Depends(verify_dashboard_password)])
def get_status():
    """Returns runtime status of the alert engine and system parameters."""
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

    return {
        "engine_status": runner.status,
        "uptime_seconds": uptime,
        "last_check_time": runner.last_check_time,
        "active_monitors_count": active_monitors,
        "active_rules_count": active_rules,
        "sqlite_db_size_bytes": db_size,
        "poll_interval_seconds": runner.engine.config.poll_interval_seconds if runner.engine else 60,
        "error_count": runner.error_count,
        "last_error": runner.last_error
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
    try:
        config = load_config(CONFIG_PATH)
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
