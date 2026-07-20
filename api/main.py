import sys
import os
import logging

logger = logging.getLogger(__name__)

# Resolve monorepo directories
root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
view_dir = os.path.join(root_dir, "owl-street-view")
pulse_dir = os.path.join(root_dir, "owl-street-pulse")

for d in [view_dir, pulse_dir, root_dir]:
    if d not in sys.path:
        sys.path.insert(0, d)

app = None

# Import Owl Street View app
try:
    from src.web import app as view_app
    app = view_app
except Exception as e:
    logger.error(f"Failed to import view app: {e}")

# Import Owl Street Pulse app and mount under /pulse
try:
    sys.path.insert(0, pulse_dir)
    from owl_street_pulse.src.web import app as pulse_app
    if app:
        app.mount("/pulse", pulse_app)
    else:
        app = pulse_app
except Exception as e:
    logger.warning(f"Failed to mount pulse app: {e}")

if not app:
    from fastapi import FastAPI
    from fastapi.responses import JSONResponse
    app = FastAPI(title="Owl Street Fallback")
    
    @app.api_route("/{full_path:path}", methods=["GET", "POST", "PUT", "DELETE"])
    def error_handler(full_path: str):
        return JSONResponse(
            status_code=500,
            content={"status": "error", "message": "Serverless Startup Failure"}
        )
