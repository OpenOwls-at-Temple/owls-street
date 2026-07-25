# Owl Street Trading & Alerting Ecosystem — ANTIGRAVITY Guide 🦉📈

Welcome to the Owl Street monorepo entry point for Antigravity. This file provides an overview of the monorepo structure, package layouts, and system-wide commands/rules.

## Monorepo Layout

The project is structured as a two-tier monorepo:
* **Repository Root**: Contains system-wide spec files, global environment configurations, and documentation.
* **[owl-street-pulse](./owl-street-pulse)**: Real-time Technical Alert Engine & Owl Speaks Ollama chat server (Python/FastAPI).
* **[owl-street-view](./owl-street-view)**: High-fidelity Trading Dashboard & Option Matrix (FastAPI backend + React frontend).

## Key Commands

### Global/Root Level
There are no global run scripts; actions are delegated to individual packages.

### Pulse (Alert Engine)
* **Start Server**: `./run.sh` (or `python -m src.main` within venv)
* **Start Once (Cron Mode)**: `./run.sh --once`
* **Run Tests**: `source .venv/bin/activate && pytest tests/ -v`

### View (Trading Dashboard)
* **Start Backend & Build Frontend**: `./run.sh`
* **Start Frontend Dev Server**: `cd frontend && npm start` (HMR, proxies requests to `:8080`)
* **Build Frontend Assets**: `cd frontend && npm run build`

## Code Guidelines & Agent Rules

1. **Keep Comments and Docs**: Preserve existing code docstrings and comments unless specifically modifying that logic.
2. **Glassmorphism Theme**: Always adhere to the established glassmorphic dark theme tokens in `theme.css`.
3. **No Unused Placeholders**: Utilize working API integration/mock logic rather than dummy placeholders.
4. **Environment Variables**: Configure and load environment variables using Pydantic in Python and `process.env` in JS. Never hardcode credentials.
