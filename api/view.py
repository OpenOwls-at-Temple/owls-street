"""Vercel function for owls-street-view, the trading dashboard's API.

This is the root-level entrypoint used when both apps deploy as a single Vercel project.
owls-street-view/api/index.py is the equivalent for the one-project-per-app shape; the two
differ only in where they put the app directory on sys.path.
"""
import logging
import os
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Both apps have a top-level package named `src`, so whichever directory is first here
# decides which one `from src.web import app` resolves to. They run as separate functions,
# each with its own interpreter, so there is no conflict at runtime — but the insert must
# come before the import.
sys.path.insert(0, os.path.join(REPO_ROOT, "owls-street-view"))

from src.web import app, startup_event  # noqa: E402

# Vercel's Python runtime invokes the ASGI app per request and does not run
# lifespan/startup events, so `alpaca_service` would stay uninitialised and every
# endpoint would fail. Initialise eagerly at import time (once per cold start).
try:
    startup_event()
except Exception:  # pragma: no cover - never let init failure break the import
    logging.getLogger(__name__).exception("Eager startup initialisation failed")
