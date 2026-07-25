import sys
import os

# Ensure owls-street-view is in sys.path when deployed from monorepo root
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "owls-street-view"))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from src.web import app
