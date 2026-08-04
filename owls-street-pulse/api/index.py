import os
import sys

# Ensure the project root is in sys.path so `src.*` imports resolve on Vercel
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Only /tmp is writable in a serverless function. Nothing in this mode writes to the
# database — the engine runs elsewhere — but chat reads it for context if it exists, and
# the default relative path would raise on an unwritable filesystem.
os.environ.setdefault("WEB_DB_PATH", "/tmp/alerts.db")

# Use the lightweight Vercel-specific app instead of the full engine, which needs
# a persistent process (background worker thread + writable SQLite file).
from src.vercel_app import app as pulse_app  # noqa: E402


def _build_app():
    """Serve Pulse at the domain root, or under a path prefix when one is configured.

    When both apps share one deployment, Pulse is served under a prefix and Vercel hands
    the function the original request path — so this app sees /pulse/api/status rather than
    /api/status. Mounting under the prefix strips it for routing, leaving the app's own
    route table identical to the copy that serves from a domain root. The dashboard
    template adds the same prefix to its own calls; see resolveUrl() in
    src/templates/index.html.
    """
    prefix = (os.environ.get("PULSE_PATH_PREFIX") or "").strip().rstrip("/")
    if not prefix:
        return pulse_app

    from fastapi import FastAPI

    outer = FastAPI()
    outer.mount(prefix, pulse_app)
    return outer


# Assigned unconditionally at the top level: Vercel resolves the configured entrypoint
# ("api.index:app") by inspecting this module's top-level definitions.
app = _build_app()
