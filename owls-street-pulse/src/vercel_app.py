"""
Vercel-specific lightweight entrypoint for Owls Street Pulse.

The full Pulse alert engine requires a persistent server with writable filesystem
(threading, SQLite, file-based config). This module provides a Vercel-compatible
FastAPI app that serves the dashboard UI and returns informational API responses
without importing the heavy engine/database/chat modules.
"""
import os
import sys
from datetime import datetime, timezone
from typing import Optional, List, Dict
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Ensure parent directory is in sys.path for resolving templates
PULSE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PULSE_ROOT not in sys.path:
    sys.path.insert(0, PULSE_ROOT)

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


# ── Informational API Endpoints ────────────────────────────────────────────────

@app.get("/api/status")
def get_status(request: Request):
    """Returns a status response indicating serverless mode."""
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
        "auth_enabled": False,
        "authorized": True,
        "user": None,
        "google_sso_configured": False,
        "serverless_mode": True,
        "message": (
            "Running in Vercel serverless mode. "
            "The alert engine, database, and chat features require a persistent server."
        ),
    }


@app.get("/api/auth/config")
def get_auth_config():
    """Returns auth configuration (disabled in serverless mode)."""
    return {
        "auth_enabled": False,
        "authorized": True,
        "password_enabled": False,
        "google_enabled": False,
    }


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
def chat(payload: ChatRequest):
    return JSONResponse(
        status_code=503,
        content={
            "status": "unavailable",
            "message": (
                "The Owl Speaks chat agent requires a local Ollama instance "
                "and is not available in serverless mode."
            ),
        },
    )


# ── Auth Stubs (no-op in serverless) ───────────────────────────────────────────

@app.post("/api/auth/login")
def login():
    return {"status": "success", "message": "Auth disabled in serverless mode"}


@app.post("/api/auth/logout")
def logout():
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
