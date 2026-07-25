import sys
import os

# Ensure the parent directory is in sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Use the lightweight Vercel-specific app instead of the full engine
from api.vercel_app import app
