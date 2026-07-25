# Authentication & Security Spec

This document details the security model, configuration loading policies, and data boundaries implemented across the project.

## Dashboard Lockscreen Overlay
* To protect private portfolio details, order execution history, and API configurations, the dashboard provides a frontend gated Password Overlay.
* Requests to private FastAPI endpoints are verified using simple token/cookie sessions mapping back to the dashboard's environment variables.
* The frontend overlay blocks component interaction until the password validation is approved.

## Secrets and Credential Loading
1. **No Commits of Credentials**: Private keys, Alpaca accounts, API secrets, webhooks, and Google OAuth credentials (`google-oauth-secret.json`) must remain untracked by Git.
2. **Environment Variable Injection**: The YAML loader (`src/config.py` in both packages) reads environment values dynamically using Pydantic syntax:
   ```yaml
   api_key: ${ALPACA_API_KEY}
   ```
   If environment variables are missing, the configuration parsing throws clear exception errors on server boot.

## Docker Safety (Pulse Backend)
* In dockerized VPS deployments:
  * The database directory (`data/`) and logs directory (`logs/`) should have restricted user permissions.
  * The docker container is built to run under a secure non-root user account to prevent system-wide root exploit vectors.
