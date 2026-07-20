# Owl Street Pulse Backend Deployment

This document covers local setup, docker deployments, and command parameters.

## Local Configuration
* Uses the launcher script `run.sh`:
  1. Installs Python `virtualenv` and dependencies from `requirements.txt`.
  2. Copies `.env.example` -> `.env` and `config/config.yaml.example` -> `config/config.yaml` if not present.
  3. Activates the environment and boots the FastAPI server via Uvicorn.
* Script execution arguments:
  * `--port <number>`: Port override (default `8000`).
  * `--host <address>`: Host override (default `0.0.0.0`).
  * `--db <filepath>`: Path to SQLite DB (default `data/alerts.db`).
  * `--config <filepath>`: Path to YAML settings (default `config/config.yaml`).
  * `--once`: One-off check evaluation cycle (exits after evaluation).

## Production Docker Deployment

The application is containerized for production reliability (e.g., on a VPS).

### Dockerfile
* Standard Python base image (`python:3.9-slim`).
* Installs dependencies directly to optimize image size.
* Creates and runs as a secure non-root `appuser`.
* Exposes port `8000`.

### Docker Compose
* Configured in `docker-compose.yml` to:
  * Mount host database folder to `/app/data`.
  * Mount host logs folder to `/app/logs`.
  * Pass `.env` variables (e.g. `ALPACA_API_KEY`, webhooks).
  * Automatically restart container on failure.
