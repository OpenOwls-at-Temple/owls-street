#!/bin/bash
set -e

# Navigate to project root
cd "$(dirname "$0")"

echo "============================================="
echo "🚨 Owl Street Pulse Launcher"
echo "============================================="

# 1. Check/copy configuration templates
if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    echo "[Config] Copying .env.example to .env..."
    cp .env.example .env
    echo "⚠️  Created .env file. Please edit it with your credentials/webhooks."
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

# Ensure data and logs directories exist
mkdir -p data logs

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

# 3. Start the application
echo "============================================="
echo "Starting Owl Street Pulse system..."
echo "============================================="

PYTHONPATH=. "$PYTHON_BIN" -m src.main --config config/config.yaml --db data/alerts.db "$@"

