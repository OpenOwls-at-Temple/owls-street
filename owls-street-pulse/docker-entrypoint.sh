#!/bin/sh
set -e

# Paths default to the in-image locations but follow the env vars when a platform mounts a
# persistent volume elsewhere. Render allows only one disk per service, so both the config
# file and the database are pointed at it — see render.yaml.
CONFIG_PATH="${WEB_CONFIG_PATH:-config/config.yaml}"
DB_PATH="${WEB_DB_PATH:-data/alerts.db}"
CONFIG_DIR=$(dirname "$CONFIG_PATH")
DB_DIR=$(dirname "$DB_PATH")

# A mounted volume can arrive owned by root. If we started as root, take ownership of the
# writable paths and then drop to appuser, so the app itself never runs privileged.
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$CONFIG_DIR" "$DB_DIR" logs
  chown -R appuser:appuser "$CONFIG_DIR" "$DB_DIR" logs 2>/dev/null || true
  exec setpriv --reuid=appuser --regid=appuser --init-groups "$0" "$@"
fi

# config.yaml is deliberately not in version control — it holds live settings the Settings
# tab writes back. Seed it from the example, mirroring run.sh, so a fresh volume doesn't
# leave load_config raising FileNotFoundError.
if [ ! -f "$CONFIG_PATH" ]; then
  if [ -f config/config.yaml.example ]; then
    echo "[entrypoint] $CONFIG_PATH missing — seeding from config/config.yaml.example"
    mkdir -p "$CONFIG_DIR"
    cp config/config.yaml.example "$CONFIG_PATH"
  else
    echo "[entrypoint] WARNING: $CONFIG_PATH missing and config/config.yaml.example not found"
  fi
fi

exec "$@"
