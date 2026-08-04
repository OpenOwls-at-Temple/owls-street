"""Vercel function for owls-street-pulse, served under /pulse.

Vercel hands a rewritten request to the function with its *original* path intact, so this
function sees `/pulse/api/status`, not `/api/status`. Mounting the app under `/pulse`
strips the prefix for routing while leaving the sub-app's own route table unchanged, which
keeps it identical to the copy that serves from a domain root elsewhere.

The dashboard template resolves its own API calls against the same prefix — see
`resolveUrl` in owls-street-pulse/src/templates/index.html.
"""
import os
import sys

from fastapi import FastAPI

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PULSE_ROOT = os.path.join(REPO_ROOT, "owls-street-pulse")

# See the note in api/view.py: `src` is ambiguous across the two apps, so this must precede
# the import below.
sys.path.insert(0, PULSE_ROOT)

# Only /tmp is writable in a serverless function. Nothing in this mode writes to the
# database — the engine runs elsewhere — but chat reads it for context if it exists, and
# the default relative path would raise on an unwritable filesystem.
os.environ.setdefault("WEB_DB_PATH", "/tmp/alerts.db")

from src.vercel_app import app as pulse_app  # noqa: E402

# Use the lightweight serverless app rather than the full engine, which needs a persistent
# process (background worker thread + writable SQLite file).
app = FastAPI()
app.mount("/pulse", pulse_app)
