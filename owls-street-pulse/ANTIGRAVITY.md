# Owl Street Pulse — ANTIGRAVITY Package Guide 🚨

This is the local entry point for the **Pulse Alerting Engine & Owl Speaks Chat** service.

## Local Configuration

All specifications for this package live in:
* **[progress.md](./progress.md)**: Tracks local completed and pending features.
* **[ai_specs/overview.md](./ai_specs/overview.md)**: High-level overview of the alert daemon and AI agent service.
* **[ai_specs/features.md](./ai_specs/features.md)**: Details calculations, notifiers, and chat integrations.
* **[ai_specs/architecture.md](./ai_specs/architecture.md)**: File-by-file logic and SQLite details.
* **[ai_specs/deployment.md](./ai_specs/deployment.md)**: Docker containerization and daemon settings.

## Common Development Commands

Run all command scripts from the `owl-street-pulse` directory.

### Start the Alerting Web Server
Runs the web dashboard and Ollama chat proxy:
```bash
./run.sh
```

### Run Alert Checks Once
Evaluates rules once and exits:
```bash
./run.sh --once
```

### Configure Settings
Custom database path and port parameters:
```bash
./run.sh --port 8001 --db data/custom_alerts.db --config config/config.yaml
```

### Run Python Test Suite
Executes all indicator calculations and SQLite trigger evaluations:
```bash
source .venv/bin/activate
pytest tests/ -v
```
