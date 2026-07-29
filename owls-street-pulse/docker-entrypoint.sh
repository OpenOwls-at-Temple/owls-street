#!/bin/sh
set -e

# config/config.yaml is deliberately not in version control (it holds live settings the
# Settings tab writes back). Seed it from the example on first boot, mirroring run.sh, so
# a fresh volume doesn't leave load_config raising FileNotFoundError.
if [ ! -f config/config.yaml ]; then
  if [ -f config/config.yaml.example ]; then
    echo "[entrypoint] config/config.yaml missing — seeding from config/config.yaml.example"
    cp config/config.yaml.example config/config.yaml
  else
    echo "[entrypoint] WARNING: neither config/config.yaml nor config/config.yaml.example found"
  fi
fi

exec "$@"
