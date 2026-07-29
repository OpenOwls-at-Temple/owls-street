# Deploying Owls Street

Two supported shapes:

| | [Free](#free-deployment-vercel--github-actions) | [Containers](#container-deployment) |
| --- | --- | --- |
| Dashboards | Vercel Hobby | Any Docker host |
| Alert engine | GitHub Actions cron, ~10 min | Background thread, 60 s |
| Alert state | `pulse-state` branch | Persistent volume |
| Live WebSocket quotes | ✗ | ✓ |
| Owl Speaks chat | ✗ (needs Ollama) | ✓ |
| Cost | $0 | ~$5–15/mo |

The free shape delivers alerts and serves both dashboards, which covers most of what the
project is for. Move to containers when you want second-by-second polling, streaming
prices, or the chat agent.

---

# Free deployment (Vercel + GitHub Actions)

## 1. Dashboards on Vercel

Create two Vercel projects from this repository, each with **Root Directory** set to its
subfolder — `owls-street-view` and `owls-street-pulse`. Add the environment variables from
[the tables below](#environment-variables). Hobby plan is enough.

The view is fully functional. Pulse runs in reduced mode: the dashboard renders, and engine,
alert, config, and chat endpoints return `503`, which the UI detects and explains.

Because both projects watch the same repository, a push rebuilds both. Set **Ignored Build
Step** per project to skip no-op builds:

```sh
git diff --quiet HEAD^ HEAD -- .
```

## 2. Alert engine on GitHub Actions

[.github/workflows/pulse-engine.yml](.github/workflows/pulse-engine.yml) runs the engine on
a schedule using the `--once` mode built into `src/main.py`. Notifications go straight from
the runner to Discord, Slack, or Telegram, so no server is involved.

**Add repository secrets** (Settings → Secrets and variables → Actions): `ALPACA_API_KEY`,
`ALPACA_API_SECRET`, plus whichever of `DISCORD_WEBHOOK_URL`, `SLACK_WEBHOOK_URL`,
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` you use.

**Commit `owls-street-pulse/config/config.yaml`** with your monitors and at least one
notifier enabled. This matters: without that file the workflow falls back to
`config.yaml.example`, whose only enabled notifier is `console` — alerts would print to the
run log and reach nobody. The Settings tab can't help here, since Pulse's Vercel deployment
can't write config.

Then trigger it once by hand (Actions → Pulse Alert Engine → Run workflow) to confirm it
works before relying on the schedule.

### How state survives between runs

`alerts.db` holds the trigger and cooldown state that stops an alert re-firing every run.
The workflow restores it from an orphan `pulse-state` branch and force-pushes a fresh
single-commit branch afterwards, so the repository doesn't accumulate binary blobs and
`main`'s history stays clean. It persists state even when a run fails, because any alert
already dispatched has had its cooldown recorded.

A run **fails loudly** if any rule couldn't be evaluated — expired Alpaca credentials show
up as a red ✗ rather than a green check with nothing delivered.

### Limits to accept

- **Granularity is ~10 minutes**, not 60 seconds. GitHub's minimum cron interval is 5
  minutes and scheduled runs are queued, so they can be late under load.
- **Public repository required.** Actions minutes are unlimited on public repos; private
  repos get 2,000/month, far short of a 10-minute schedule.
- **Market hours only** by default. Crypto trades continuously — widen the cron if you
  monitor it.
- **GitHub disables scheduled workflows after 60 days of repository inactivity.** A commit
  or a manual run re-enables them.
- The Pulse dashboard on Vercel **won't show these alerts**, since it can't read the state
  branch. The run logs and your notifier channel are the record.

---

# Container deployment

Runs both apps on a single host with every feature working — Pulse's background engine, its
SQLite state, the view's WebSocket quote stream, and the Owl Speaks proxy.

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

## Notes on the Vercel side

Details behind the [free deployment](#1-dashboards-on-vercel) above:

- **Why Pulse is reduced.** The engine needs a persistent process and a writable SQLite
  file, neither of which exists on Vercel, so
  [src/vercel_app.py](owls-street-pulse/src/vercel_app.py) serves the dashboard and returns
  `503` elsewhere. That is why the engine moves to GitHub Actions.
- **Vercel Cron can't replace it.** Hobby crons run at most once per day, with a limit of
  two jobs. Minute-level scheduling needs Pro, plus a hosted database for state — more cost
  and more work than the Actions route for a worse result.
- **No live quote stream.** `/ws/quotes` is a WebSocket, unsupported on any Vercel plan.
  The dashboard loads and REST calls work; streaming prices don't.
- **Cold starts.** The view function pulls in `pandas` and `alpaca-py`.
- **Always set a Root Directory.** The repository root is not deployable; a root-level
  import will fail.

## Local development

Unchanged — see the per-app `run.sh` scripts and the root [README](./README.md).
