import sys
import os

# Resolve paths for monorepo structure on Vercel
root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
view_dir = os.path.join(root_dir, "owl-street-view")

if view_dir not in sys.path:
    sys.path.insert(0, view_dir)

if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

try:
    from src.web import app
except Exception as e:
    from fastapi import FastAPI
    from fastapi.responses import JSONResponse
    app = FastAPI(title="Owl Street View Fallback")
    
    @app.api_route("/{full_path:path}", methods=["GET", "POST", "PUT", "DELETE"])
    def error_handler(full_path: str):
        return JSONResponse(
            status_code=500,
            content={"status": "error", "message": "Serverless Startup Failure", "detail": str(e)}
        )
