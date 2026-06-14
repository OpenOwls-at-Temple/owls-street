import os
import time
import logging
import threading
from datetime import datetime, timezone
from typing import Dict, Any, Optional
from fastapi import FastAPI, Request, Response, HTTPException, Depends
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

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

# Authentication dependency
def verify_dashboard_password(request: Request):
    password = os.environ.get("DASHBOARD_PASSWORD")
    if not password:
        return True  # Auth is disabled if no password is set
        
    token = request.cookies.get("session_token")
    if token != password:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return True

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

@app.post("/api/auth/login")
def login(payload: dict, response: Response):
    """Authenticates user and sets session cookie."""
    password = os.environ.get("DASHBOARD_PASSWORD")
    if not password:
        return {"status": "success", "message": "Auth disabled"}
        
    user_password = payload.get("password")
    if user_password == password:
        # Secure flag can be added, but since it runs locally or private servers, simple cookie is robust
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
    """Clears authentication session cookie."""
    response.delete_cookie("session_token")
    return {"status": "success"}

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
