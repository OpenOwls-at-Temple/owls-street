import sys
import os
import logging

# Ensure the parent directory is in sys.path so imports like 'from src.web import app' resolve cleanly
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.web import app, startup_event

# Vercel's Python runtime invokes the ASGI app per request and does not run
# lifespan/startup events, so `alpaca_service` would stay uninitialised and every
# endpoint would fail. Initialise eagerly at import time (once per cold start).
try:
    startup_event()
except Exception:  # pragma: no cover - never let init failure break the import
    logging.getLogger(__name__).exception("Eager startup initialisation failed")
