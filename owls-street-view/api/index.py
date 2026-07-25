import sys
import os

# Ensure the parent directory is in sys.path so imports like 'from src.web import app' resolve cleanly
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.web import app
