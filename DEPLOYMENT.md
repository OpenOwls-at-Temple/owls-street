# Deploying Owls Street

Two supported shapes:

| | [Free](#free-deployment-vercel--github-actions) | [Containers](#container-deployment) |
| --- | --- | --- |
| Dashboards | Vercel Hobby | Any Docker host |
| Alert engine | GitHub Actions cron, ~10 min | Background thread, 60 s |
| Alert state | `pulse-state` branch | Persistent volume |
| Live WebSocket quotes | ✗ | ✓ |
| Owl Speaks chat | ✓ with an Ollama Cloud key | ✓ |
| Cost | $0 | ~$5–15/mo |

The free shape delivers alerts and serves both dashboards, which covers most of what the
project is for. Move to containers when you want second-by-second polling or streaming
prices.

---

# Free deployment (Vercel + GitHub Actions)

## 1. Dashboards on Vercel

Everything deploys as **one Vercel project** using [Vercel Services](https://vercel.com/docs/services),
which builds several apps in a single project with shared routing, environment variables,
and one domain. [vercel.json](vercel.json) declares three services and the top-level
rewrites that expose them:

| Path | Service | Root |
| --- | --- | --- |
| `/pulse`, `/pulse/*` | `pulse` | `owls-street-pulse` (FastAPI, `api.index:app`) |
| `/api/*`, `/auth/*` | `view` | `owls-street-view` (FastAPI, `api.index:app`) |
| everything else | `frontend` | `owls-street-view/frontend` (the React SPA, from the CDN) |

A service is private until a top-level rewrite targets it, and routing into one is final —
if nothing inside it matches, Vercel returns that service's 404 rather than falling through
to the next rewrite.

Each service builds independently from **its own root**, so each Python service installs
its own `requirements.txt` and the SPA builds with its own `package.json`. There is no
merged dependency list to keep in sync.

One project also means one domain and one set of environment variables, which is what lets
the two apps agree on `DASHBOARD_PASSWORD` — see [Owl Speaks needs a matching
password](#owl-speaks-needs-a-matching-password-on-both-services) — and puts the embedded
Pulse dashboard on the same origin as the view, so the iframe's theme sync works.

### Deploy it

```sh
npx vercel link          # once, to create or attach the project
npx vercel deploy        # a preview build, to check it first
npx vercel deploy --prod
```

Leave **Root Directory** empty. Vercel reads the per-service roots from `vercel.json`;
setting a Root Directory would scope the whole project to a subfolder and the services
would not be found.

Add the environment variables from [the tables below](#environment-variables), at minimum:

| Variable | Value |
| --- | --- |
| `ALPACA_API_KEY` / `ALPACA_SECRET_KEY` | your Alpaca credentials (the view reads `ALPACA_SECRET_KEY`) |
| `ALPACA_API_SECRET` | the same secret again — Pulse's chat context reads this name |
| `SSO_JWT_SECRET` | a random string; without it both apps fall back to a hardcoded default |
| `DASHBOARD_PASSWORD` | shared by both apps, and how the view authenticates its chat proxy |
| `PULSE_PATH_PREFIX` | `/pulse` — required, see below |
| `PULSE_URL` | `https://<your-domain>/pulse` |
| `OLLAMA_API_KEY` | an [Ollama Cloud](#owl-speaks-on-vercel) key, for chat — or `OLLAMA_BASE_URL` if you host the endpoint yourself |

`PULSE_URL` cannot be known before the first deploy. Deploy once, read the production
domain off the deployment, then set it and redeploy.

`PULSE_PATH_PREFIX` is what makes Pulse work under `/pulse`. A service receives the
**original** request path, so Pulse's function sees `/pulse/api/status`, not
`/api/status`. With the prefix set, [owls-street-pulse/api/index.py](owls-street-pulse/api/index.py)
mounts the app under it, which strips the prefix for routing and leaves the app's own route
table identical to the copy that serves from a domain root. Leave it **unset** for local
development and for a project-per-app deployment, where Pulse already owns its root path.

### Owl Speaks on Vercel

Chat is one outbound call to an LLM, so it needs no persistent process and works here — but
a serverless function has no loopback interface, so the default
`OLLAMA_BASE_URL=http://localhost:11434` cannot resolve to anything.

**The simplest fix is an Ollama Cloud key.** Create one at
[ollama.com/settings/keys](https://ollama.com/settings/keys), set `OLLAMA_API_KEY`, and
leave `OLLAMA_BASE_URL` unset:

```
OLLAMA_API_KEY=<your key>
OLLAMA_MODEL=gpt-oss:120b       # optional; this is the default when a key is set
```

Requests then go to `https://ollama.com/api/chat` with a bearer token. It is the same
native API a local Ollama serves, so nothing else changes. Cloud model names are a
different catalogue from a local install's — `gpt-oss:120b`, not `llama3.1` — which is why
the default model follows the endpoint. See [ollama.com/search](https://ollama.com/search)
for what is available.

The alternative is hosting the endpoint yourself and setting `OLLAMA_BASE_URL` to it: a
tunnel to a machine running Ollama (`cloudflared`, `tailscale funnel`, `ngrok`), or an
Ollama-compatible endpoint elsewhere. An explicit `OLLAMA_BASE_URL` always wins over the
key, and the key is still sent as a bearer token if both are set — which is what an Ollama
behind an authenticating proxy wants.

Pulse reports which state it is in rather than failing opaquely: `/pulse/api/status`
returns `chat_available`, the dashboard's serverless notice says so, and
`POST /pulse/api/chat` answers `503` naming the variables to set. Once configured, a
rejected key, a missing key, and an absent model each get their own message — Ollama Cloud
answers `401 {"error":"Unauthorized"}` identically whether a key is wrong or absent, so the
distinction comes from what this deployment has configured.

Chat degrades rather than breaks when market context is missing. Without a committed
`owls-street-pulse/config/config.yaml` there are no monitors to compute indicators for, and
the serverless filesystem has no alert history — the model still answers, and says what it
could not see. Set the Alpaca variables to get live quotes and news in its context.

### What still doesn't work

The engine, alert log, config editor, and `/ws/quotes` need a persistent server; those
endpoints return `503` and the UI explains why. The engine moves to GitHub Actions below.

### Two projects instead of one

The per-app configs ([owls-street-view/vercel.json](owls-street-view/vercel.json),
[owls-street-pulse/vercel.json](owls-street-pulse/vercel.json)) still work if you prefer a
project per app — or if your account does not have the `services` permission. Each gets
**Root Directory** set to its subfolder, and `PULSE_PATH_PREFIX` stays unset because Pulse
owns its own root path there. You then have two domains, and must keep
`DASHBOARD_PASSWORD` and `SSO_JWT_SECRET` identical across both by hand. Set **Ignored
Build Step** per project to skip no-op builds:

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
| `PULSE_URL` | set by compose | Owl Speaks chat proxy target, and the embedded Pulse dashboard's iframe source. On a combined Vercel deployment set it to `https://<domain>/pulse` |
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
| `OLLAMA_API_KEY` | optional | [Ollama Cloud](https://ollama.com/settings/keys) key. Implies `https://ollama.com` when `OLLAMA_BASE_URL` is unset, and is sent as a bearer token either way |
| `OLLAMA_BASE_URL` / `OLLAMA_MODEL` | optional | Owl Speaks chat agent. Default to `http://localhost:11434` and `llama3.1`, or `https://ollama.com` and `gpt-oss:120b` when a key is set. The loopback default is unreachable on Vercel |
| `PULSE_GOOGLE_REDIRECT_URI` | combined Vercel only | `https://<domain>/pulse/api/auth/google/callback`. Overrides `GOOGLE_REDIRECT_URI` for Pulse alone |
| `WEB_CONFIG_PATH` / `WEB_DB_PATH` | optional | Override config and database locations |

On Vercel, Pulse needs `SSO_JWT_SECRET` plus whichever of `DASHBOARD_PASSWORD` and
`GOOGLE_*` you use — sign-in is fully functional there. `ALPACA_API_KEY` /
`ALPACA_API_SECRET` are optional: the engine runs elsewhere, but chat uses them for live
quotes, news, and indicator context, and answers without them if they are absent.

### Google SSO on a combined deployment

One project means one environment, and the two apps' OAuth callbacks sit at different paths
— `/api/auth/google/callback` for the view, `/pulse/api/auth/google/callback` for Pulse. A
single `GOOGLE_REDIRECT_URI` therefore cannot serve both: whichever app it names, the other
sends users to the wrong callback and they end up signed in to the wrong dashboard.

Set `GOOGLE_REDIRECT_URI` to the view's callback and `PULSE_GOOGLE_REDIRECT_URI` to Pulse's,
and register **both** URIs in the Google Cloud console.

## Never set ALLOW_MOCK_SSO in a deployment

Both apps have a development sign-in path that issues a session for a caller-supplied email
without contacting the identity provider. It is reachable **only** when `ALLOW_MOCK_SSO` is
set to `1`, and it must stay unset everywhere except a local machine. With it unset:

- `/api/auth/google/callback?code=mock_code&...` is rejected with `403`.
- `/auth/google-mock/login` and the view's `/api/auth/microsoft/mock-*` routes return `404`.
- Sign-in requires a real `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` pair, and `/api/auth/
  google/login` answers `503` when they're absent rather than silently falling back to mock.

OAuth `state` is random per attempt and checked against a cookie on return, so a callback
cannot be replayed or forged from another site.

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
`OLLAMA_API_KEY` to use [Ollama Cloud](#owl-speaks-on-vercel), or `OLLAMA_BASE_URL` to an
endpoint you host.

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
  [src/vercel_app.py](owls-street-pulse/src/vercel_app.py) serves the dashboard and chat and
  returns `503` for the rest. That is why the engine moves to GitHub Actions.
- **Vercel Cron can't replace it.** Hobby crons run at most once per day, with a limit of
  two jobs. Minute-level scheduling needs Pro, plus a hosted database for state — more cost
  and more work than the Actions route for a worse result.
- **No live quote stream.** `/ws/quotes` is a WebSocket, unsupported on any Vercel plan.
  The dashboard loads and REST calls work; streaming prices don't.
- **Cold starts.** The view's function pulls in `pandas` and `alpaca-py`. Pulse's chat needs
  them too, but imports the agent lazily, so its endpoints that never chat don't pay for it.
- **Each service installs its own dependencies.** Per-service roots mean
  `owls-street-view/requirements.txt` and `owls-street-pulse/requirements.txt` are used
  directly — the same files local development, Docker, and CI use. Nothing to keep in sync.
- **Why Pulse is mounted rather than path-rewritten.** A service receives the original
  request path, so Pulse's function sees `/pulse/api/status`. Mounting under
  `PULSE_PATH_PREFIX` strips it for routing, leaving the app identical to the copy that
  serves from a domain root. Vercel can do this instead with a `request.path` transform in
  the service's `routes`; doing it in the app keeps the behaviour testable with the rest of
  the suite and portable to hosts with no equivalent feature. The dashboard's own calls go
  through `resolveUrl()`, which adds the same prefix.
- **`/pulse` state is per-invocation.** `WEB_DB_PATH` defaults to `/tmp/alerts.db` because
  nothing else is writable. Nothing in this mode writes to it; chat reads it if present.
- **Pin the Python version.** Each app has a `.python-version` of `3.12`, matching CI.
  Without it the builder picks its own default, and `vercel build` run locally will
  generate a `pyproject.toml` and `uv.lock` from whatever Python the machine has — both are
  gitignored for that reason.
- **`services` is in Beta** and gated on a permission for your Vercel account. If a deploy
  rejects the `services` key, fall back to
  [a project per app](#two-projects-instead-of-one).

## Local development

Unchanged — see the per-app `run.sh` scripts and the root [README](./README.md).
