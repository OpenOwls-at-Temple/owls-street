import os
import time
import logging
import threading
from datetime import datetime, timezone
from typing import Dict, Any, Optional
import hashlib
from fastapi import FastAPI, Request, Response, HTTPException, Depends
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from src.auth_helper import verify_jwt, create_jwt, MOCK_GOOGLE_LOGIN_HTML

from src.config import load_config, save_config, AppConfig
from src.engine import AlertEngine
from src.database import StateDatabase

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

# Google OAuth Configuration
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET")



# Authentication dependency
def verify_dashboard_password(request: Request):
    password = os.environ.get("DASHBOARD_PASSWORD")
    if not password:
        return True  # Auth is disabled if no password is set
        
    token = request.cookies.get("session_token")
    if token == password:
        return True
        
    # Check if valid JWT
    payload = verify_jwt(token)
    if payload:
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

@app.get("/auth/google-mock/login", response_class=HTMLResponse)
def google_mock_login(state: Optional[str] = None):
    return HTMLResponse(content=MOCK_GOOGLE_LOGIN_HTML)



@app.get("/api/auth/google/login")
def google_login(request: Request, redirect_to: Optional[str] = None):
    # Store redirect origin in cookie
    referer = redirect_to or request.headers.get("referer") or "/"
    
    if GOOGLE_CLIENT_ID:
        # Real Google Auth flow
        state = "google_state"
        redirect_uri = f"{request.base_url}api/auth/google/callback"
        auth_url = (
            f"https://accounts.google.com/o/oauth2/v2/auth?"
            f"client_id={GOOGLE_CLIENT_ID}&"
            f"response_type=code&"
            f"scope=openid%20email%20profile&"
            f"redirect_uri={redirect_uri}&"
            f"state={state}"
        )
        response = RedirectResponse(auth_url)
    else:
        # Mock Google Auth flow
        state = "google_state"
        response = RedirectResponse(url=f"/auth/google-mock/login?state={state}")
        
    response.set_cookie(key="sso_redirect_origin", value=referer, httponly=True, samesite="lax")
    return response

@app.get("/api/auth/google/callback")
async def google_callback(request: Request, response: Response, code: str, state: Optional[str] = None, email: Optional[str] = None, name: Optional[str] = None):
    user_email = email or "shuv@gmail.com"
    user_name = name or "Shuv"
    
    if GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET and code != "mock_code":
        import httpx
        try:
            redirect_uri = f"{request.base_url}api/auth/google/callback"
            async with httpx.AsyncClient() as client:
                token_res = await client.post(
                    "https://oauth2.googleapis.com/token",
                    data={
                        "client_id": GOOGLE_CLIENT_ID,
                        "client_secret": GOOGLE_CLIENT_SECRET,
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
            max_age=30 * 24 * 3600
        )
        return {"status": "success", "message": "Logged in successfully"}
    
    raise HTTPException(status_code=400, detail="Invalid password")

@app.post("/api/auth/logout")
def logout(response: Response):
    """Clears authentication session cookie."""
    response.delete_cookie("session_token")
    return {"status": "success"}

@app.get("/api/status")
def get_status(request: Request):
    """Returns runtime status of the alert engine and system parameters, including SSO configuration."""
    password = os.environ.get("DASHBOARD_PASSWORD")
    auth_required = bool(password and password.strip() != "")
    authorized = False
    user_info = None
    
    token = request.cookies.get("session_token")
    if not auth_required:
        authorized = True
    elif token == password:
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

    return {
        "engine_status": runner.status,
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
