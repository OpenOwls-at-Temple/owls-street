import sys
import os

# Ensure the project root is in sys.path so `src.*` imports resolve on Vercel
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Use the lightweight Vercel-specific app instead of the full engine, which needs
# a persistent process (background worker thread + writable SQLite file).
from src.vercel_app import app
