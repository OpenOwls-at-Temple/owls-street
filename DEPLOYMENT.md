# Deploying Owls Street

Both apps run as containers on a single host. This keeps every feature working — Pulse's
background alert engine, its SQLite state, the view's live WebSocket quote stream, and the
Owl Speaks chat proxy between the two.

A [limited Vercel deployment](#alternative-vercel-serverless) also exists, but Pulse's
engine cannot run there. Use containers unless you specifically need Vercel's CDN.

## Quick start

```sh
cp owls-street-pulse/.env.example owls-street-pulse/.env
cp owls-street-view/.env.example  owls-street-view/.env
# edit both with your Alpaca credentials and an SSO_JWT_SECRET

docker compose up -d --build
```

- Dashboard → http://localhost:8080
- Pulse → http://localhost:8000

The view reaches Pulse over the compose network at `http://pulse:8000`; the root
[docker-compose.yml](docker-compose.yml) sets `PULSE_URL` for you, overriding whatever is
in `.env`. Requires Docker Compose v2.24+.

Useful commands:

```sh
docker compose logs -f view      # follow one service
docker compose up -d pulse       # start only the alert engine
docker compose down              # stop both, keep volumes
docker compose down -v           # stop both and discard Pulse's database
```

To run Pulse alone, [owls-street-pulse/docker-compose.yml](owls-street-pulse/docker-compose.yml)
is a standalone equivalent.

## Persistence

Pulse writes to two named volumes:

| Volume | Mount | Holds |
| --- | --- | --- |
| `pulse-config` | `/app/config` | `config.yaml` — monitors, rules, and notifier settings the Settings tab writes back |
| `pulse-data` | `/app/data` | `alerts.db` — alert history plus the trigger/cooldown state that stops duplicate alerts |

Named volumes rather than bind mounts, for two reasons: the containers run as a non-root
user, so bind mounts need matching host uids to stay writable, and a bind mount over
`config/` would hide the seeded `config.yaml` — only `config.yaml.example` is in version
control. `docker-entrypoint.sh` seeds it on first boot.

Back up the database with:

```sh
docker compose exec pulse cat data/alerts.db > alerts-backup.db
```

The view is stateless — its configuration comes entirely from environment variables — so
it has no volumes and can be rebuilt or scaled freely.

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
| `PULSE_URL` | set by compose | Owl Speaks chat proxy target |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | optional | Google SSO |
| `GOOGLE_REDIRECT_URI` | with Google SSO | `https://<domain>/api/auth/google/callback` |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | optional | Microsoft Entra SSO (Temple's tenant) |
| `MICROSOFT_REDIRECT_URI` | with Microsoft SSO | `https://<domain>/api/auth/microsoft/callback` |
| `ALLOWED_EMAILS` | optional | Comma-separated allowlist for Google sign-ins |
| `MICROSOFT_ALLOWED_EMAILS` | optional | Comma-separated allowlist for Microsoft sign-ins |

### `owls-street-pulse`

| Variable | Required | Notes |
| --- | --- | --- |
| `ALPACA_API_KEY` / `ALPACA_API_SECRET` | yes | Market data for the alert engine |
| `SSO_JWT_SECRET` | yes | Same warning as above |
| `DISCORD_WEBHOOK_URL`, `SLACK_WEBHOOK_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | optional | Alert destinations |
| `DASHBOARD_PASSWORD` | optional | Enables password auth |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` / `ALLOWED_EMAILS` | optional | Google SSO (Pulse has no Microsoft SSO) |
| `OLLAMA_BASE_URL` / `OLLAMA_MODEL` | optional | Owl Speaks chat agent |
| `WEB_CONFIG_PATH` / `WEB_DB_PATH` | optional | Override config and database locations |

Owl Speaks needs a reachable Ollama instance. Running on the host, point
`OLLAMA_BASE_URL` at `http://host.docker.internal:11434`.

## Deploying to Render

[render.yaml](render.yaml) is a Blueprint that creates both services. In the Render
dashboard: **Blueprints → New Blueprint Instance**, pick this repository. Render reads the
file and prompts for each secret marked `sync: false` — at minimum the Alpaca credentials
for both services.

It sets up:

- Two Docker web services on the **Starter** plan, both in `oregon`, health-checked on
  `/api/status`.
- A 1 GB disk on Pulse mounted at `/app/data`, holding both `alerts.db` and `config.yaml`
  (Render allows one disk per service, so `WEB_DB_PATH` and `WEB_CONFIG_PATH` both point
  at it).
- `PULSE_URL` on the view pointing at Pulse's internal address.
- `DASHBOARD_PASSWORD` and `SSO_JWT_SECRET` pulled from Pulse into the view, so they can't
  drift apart — see the warning below.

**Do not put Pulse on the free plan.** Free services spin down when idle, which stops the
alert engine, and persistent disks aren't available on free at all. Losing that disk means
losing the trigger/cooldown state that prevents already-sent alerts from re-firing.

After the first deploy, update `GOOGLE_REDIRECT_URI` / `MICROSOFT_REDIRECT_URI` to the
generated `onrender.com` domains and register them in the Google Cloud and Entra consoles.

### Owl Speaks needs a matching password on both services

The view authenticates its chat proxy to Pulse by sending `DASHBOARD_PASSWORD` as the
`pulse_session_token` cookie, which Pulse compares against its own `DASHBOARD_PASSWORD`.
If the two differ, Pulse answers `401` and the view surfaces a `502`. The Blueprint shares
one value across both services to prevent this. If you configure the services by hand,
keep them in sync.

Owl Speaks also needs a reachable Ollama instance, which Render does not provide — set
`OLLAMA_BASE_URL` to an externally hosted endpoint or accept that chat stays unavailable.

## Other managed hosts

Any platform that runs a Dockerfile works. Two requirements: Pulse needs a **persistent
volume** on `/app/data`, and it must run as a **long-lived process**, not scale-to-zero, or
the engine stops polling.

- **Fly.io** — `fly launch` in each app directory, then `fly volumes create` for Pulse.
  Set `auto_stop_machines = false` on Pulse in `fly.toml`.
- **Railway** — point a service at each directory; add a volume on `/app/data` for Pulse.

Both containers listen on `$PORT` when the platform sets one, falling back to 8000 (Pulse)
and 8080 (the view).

## Alternative: Vercel (serverless)

The per-app `vercel.json` and `api/index.py` files support deploying each app as its own
Vercel project with **Root Directory** set to its subfolder. This works, but with real
limits:

- **Pulse runs in reduced mode.** The engine needs a persistent process and a writable
  SQLite file, neither of which exists on Vercel. [src/vercel_app.py](owls-street-pulse/src/vercel_app.py)
  serves the dashboard and returns `503` for engine, alert, config, and chat endpoints;
  the UI detects this and explains itself rather than erroring.
- **No live quote stream.** `/ws/quotes` is a WebSocket, which Vercel serverless does not
  support. The dashboard loads and REST calls work, but streaming prices fail.
- **Owl Speaks is unavailable** — it needs Ollama.
- **Cold starts.** The view function pulls in `pandas` and `alpaca-py`.

The view alone is a good fit for Vercel if you host Pulse in a container and point
`PULSE_URL` at it — the only feature you lose is WebSocket quotes.

Always set a Root Directory when importing this repo into Vercel. The repository root is
not deployable; a root-level import will fail.

## Local development

Unchanged — see the per-app `run.sh` scripts and the root [README](./README.md).
