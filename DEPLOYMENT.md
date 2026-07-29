# Deploying Owls Street to Vercel

The monorepo deploys as **two independent Vercel projects**, each rooted at its own
subdirectory. Both are already configured — no further code changes are needed.

| Vercel project | Root Directory | What gets deployed |
| --- | --- | --- |
| `owls-street-view` | `owls-street-view` | React SPA on the CDN + FastAPI serverless function at `/api/*` |
| `owls-street-pulse` | `owls-street-pulse` | Dashboard UI + informational API from the lightweight serverless app |

## One-time setup (Vercel dashboard)

For each project: **Add New → Project → import `OpenOwls-at-Temple/owls-street`**, then
set **Root Directory** to the subfolder from the table above. Leave Framework Preset as
*Other* — build/output settings come from each app's `vercel.json`. Add the environment
variables below, then deploy.

Because both projects import the same repo, a push touching either app triggers both
builds. Optionally set **Ignored Build Step** per project to skip no-op builds:

```sh
git diff --quiet HEAD^ HEAD -- .
```

## Environment variables

### `owls-street-view`

| Variable | Required | Notes |
| --- | --- | --- |
| `ALPACA_API_KEY` | yes | Alpaca key ID |
| `ALPACA_SECRET_KEY` | yes | Alpaca secret |
| `ALPACA_MODE` | yes | `paper` or `live` |
| `SSO_JWT_SECRET` | yes | Session signing key. Without it the code falls back to a hardcoded default, so anyone could forge a session. |
| `FMP_API_KEY` | optional | Financial Modeling Prep, for screener fundamentals |
| `DASHBOARD_PASSWORD` | optional | Enables password auth |
| `PULSE_URL` | optional | `https://<pulse-domain>` — used to proxy Owl Speaks chat |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | optional | Google SSO |
| `GOOGLE_REDIRECT_URI` | with Google SSO | `https://<view-domain>/api/auth/google/callback` |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | optional | Microsoft SSO |
| `MICROSOFT_REDIRECT_URI` | with Microsoft SSO | `https://<view-domain>/api/auth/microsoft/callback` |
| `ALLOWED_EMAILS` | optional | Comma-separated allowlist for Google sign-ins |
| `MICROSOFT_ALLOWED_EMAILS` | optional | Comma-separated allowlist for Microsoft sign-ins |

`config/config.yaml` is intentionally *not* bundled into the serverless function, so the
app configures itself purely from these variables. Register the redirect URIs above in
the Google Cloud / Entra consoles — including the generated preview domains if you want
SSO to work on previews.

### `owls-street-pulse`

None. The serverless entrypoint (`src/vercel_app.py`) serves the dashboard and status
endpoints without reading any credentials.

## Known serverless limitations

- **No live quote stream.** `/ws/quotes` is a WebSocket; Vercel serverless functions
  don't support them. The dashboard loads and REST calls work, but streaming prices
  silently fail (the browser logs a WebSocket error). Prices come from REST polling only.
- **Pulse runs in reduced mode.** The real alert engine needs a persistent process
  (background worker thread) and a writable SQLite file, neither of which exists on
  Vercel. `src/vercel_app.py` serves the UI and returns `503` for engine, alert, config,
  and chat endpoints. Use the included `Dockerfile` / `docker-compose.yml` on a VPS for
  full Pulse functionality.
- **Owl Speaks chat is unavailable.** It requires a local Ollama instance.
- **Cold starts.** The view function pulls in `pandas` and `alpaca-py`, so the first
  request after idle takes a few seconds.

## Legacy root-level files

The repository root also contains `vercel.json`, `api/`, `requirements.txt`, and a
`build` script in `package.json` — leftovers from an earlier attempt to deploy the whole
monorepo as one project serving only `owls-street-view`. They are **not used** by the
two-project setup above, which reads each app's own subdirectory config. Don't import
this repo into Vercel without setting a Root Directory.

## Local development

Unchanged — see the per-app `run.sh` scripts and the root [README](./README.md).
