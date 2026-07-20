import sys
import os

# Include owl-street-view in sys.path
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "owl-street-view"))

from src.web import app
