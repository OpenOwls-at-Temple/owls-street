#!/bin/bash
set -e

# Navigate to project root
cd "$(dirname "$0")"

echo "============================================="
echo "🦉 Owl Street View Launcher"
echo "============================================="

# 1. Check/copy configuration templates
if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    echo "[Config] Copying .env.example to .env..."
    cp .env.example .env
    echo "⚠️  Created .env file. Please edit it with your Alpaca credentials."
  else
    echo "⚠️  .env file not found and .env.example is missing."
  fi
fi

if [ ! -f "config/config.yaml" ]; then
  if [ -f "config/config.yaml.example" ]; then
    echo "[Config] Copying config.yaml.example to config.yaml..."
    mkdir -p config
    cp config/config.yaml.example config/config.yaml
  else
    echo "⚠️  config/config.yaml not found and example is missing."
  fi
fi

# 2. Check Python virtual environment (.venv)
if [ ! -d ".venv" ]; then
  echo "[Python] Creating Python virtual environment (.venv)..."
  python3 -m venv .venv
  echo "[Python] Upgrading pip..."
  .venv/bin/pip install --upgrade pip
  echo "[Python] Installing dependencies from requirements.txt..."
  .venv/bin/pip install -r requirements.txt
else
  echo "[Python] Virtual environment (.venv) found."
fi

# Resolve virtual environment python binary path
PYTHON_BIN=".venv/bin/python"
if [ ! -f "$PYTHON_BIN" ]; then
  PYTHON_BIN=".venv/bin/python3"
fi

# 3. Check/Build React frontend assets
if [ ! -d "frontend/build" ]; then
  echo "[Frontend] React build directory (frontend/build) is missing."
  if command -v npm &> /dev/null; then
    echo "[Frontend] Node/npm detected. Setting up frontend..."
    cd frontend
    if [ ! -d "node_modules" ]; then
      echo "[Frontend] Installing frontend packages (npm install)..."
      npm install
    fi
    echo "[Frontend] Compiling frontend assets (npm run build)..."
    npm run build
    cd ..
    echo "[Frontend] React compilation complete!"
  else
    echo "⚠️  [Frontend] Warning: 'npm' command not found. Cannot compile React frontend automatically."
    echo "   If you have a pre-compiled build, place it in frontend/build/."
  fi
else
  echo "[Frontend] React production assets found at frontend/build."
fi

# 4. Start the application
echo "============================================="
echo "Starting Owl Street View server..."
echo "============================================="

PYTHONPATH=. "$PYTHON_BIN" src/main.py --config config/config.yaml "$@"

