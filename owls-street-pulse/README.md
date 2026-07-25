# Owls Street Pulse 🚨

A production-grade, highly reliable, and easily configurable asset alert system built in Python. It integrates with the **Alpaca API** to fetch market data, calculates key technical indicators, and dispatches real-time alerts to pluggable destination channels (**Discord**, **Slack**, **Telegram**, and **Console**).

Designed to be hosted on private servers, it is lightweight, fully containerized, and optimized to run on free tiers.

---

## Key Features

- **💻 Web UI Dashboard**: A gorgeous, secure Glassmorphism Single Page Application (built with Vanilla CSS/JS) to monitor system health, view historical trigger logs, manage rules dynamically, and dispatch test alerts.
- **🦉 Owl Speaks AI Assistant**: An interactive chatbot integrated directly into the dashboard. Powered by a local Ollama model (e.g. `llama3.1`), it queries historical database logs and live market data/indicators to provide comprehensive analysis on monitored symbols.
- **⚡ Efficient Batched Ingestion**: Groups symbols by timeframe and asset class, batching API calls to optimize network requests and bypass Alpaca API rate limits.
- **📈 Built-in Indicators**: Includes highly optimized computations for SMA, EMA, RSI (Wilder's smoothing), MACD, and Bollinger Bands with vector-based crossovers (`cross_above`, `cross_below`).
- **🛡️ Alert Deduplication**: Uses a local SQLite state database to guarantee that only **one alert is sent per candle bar** (even if the candle is open and updating) and respects configured cooldown periods.
- **🚦 Pluggable Notifiers**: Supports simultaneous alerts to Discord Webhooks (with color-coded embeds), Slack Blocks, Telegram Bot APIs, and the system Console.
- **🐳 Dockerized Deployments**: Production-ready Dockerfile and Docker Compose configurations, exposing port 8000 and running under a secure non-root user.

---

## Getting Started

### Prerequisites

- **Python 3.9+** (if running locally).
- **Docker** and **Docker Compose** (recommended for production deployment).
- **Alpaca Account**: You will need a Free Paper or Live Trading account. Create one at [Alpaca Markets](https://alpaca.markets/) and retrieve your `API Key` and `Secret Key`.

---

### Local Installation & Setup

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/your-username/owls-street-pulse.git
   cd owls-street-pulse
   ```

2. **Setup and Launch**:
   The `run.sh` script handles everything for you. It automatically copies example configurations (`.env.example` -> `.env` and `config.yaml.example` -> `config.yaml`), ensures required directories (`data`, `logs`) exist, initializes a Python virtual environment, installs dependencies, and starts the system.

   Simply run:
   ```bash
   ./run.sh
   ```
   This starts the Web UI dashboard server. Open **[http://localhost:8000](http://localhost:8000)** in your browser.

   *For one-off check cycles (e.g. to run as a cron job instead of hosting a persistent web dashboard), append the `--once` flag:*
   ```bash
   ./run.sh --once
   ```

   You can also customize parameters like the database path, config path, or port by passing them to the launcher:
   ```bash
   ./run.sh --port 8001 --db data/prod_alerts.db
   ```

---

## Deployment with Docker (Production Grade)

For 24/7 reliability on a private server (e.g. VPS), use Docker Compose.

1. Create the database and log folders on the host machine to ensure write permissions map correctly:
   ```bash
   mkdir -p data logs
   chmod 777 data logs
   ```
2. Build and run the container in detached (background) mode:
   ```bash
   docker-compose up -d --build
   ```
3. View runtime logs:
   ```bash
   docker-compose logs -f
   ```
4. Stop the daemon:
   ```bash
   docker-compose down
   ```

---

## Configuration Guide (`config/config.yaml`)

The system relies on a clean `config.yaml` to define credentials, polling cycles, channels, and rules.

### Configuration Schema

- `alpaca`:
  - `api_key` & `api_secret`: API Keys. (Automatically populated via `${ALPACA_API_KEY}` environment variables).
  - `base_url`: Alpaca Account URL (Default paper trading: `https://paper-api.alpaca.markets`).
  - `data_base_url`: Alpaca Market Data URL (Default: `https://data.alpaca.markets`).
- `poll_interval_seconds`: Wait interval before running checks again (in daemon mode).
- `notifiers`: Enable/disable destinations (`console`, `discord`, `slack`, `telegram`).
- `monitors`: A list of assets and their rules.

### Rule Properties

For each monitored asset:
- `symbol`: Ticker symbol (e.g. `AAPL`, `MSFT`, or `BTC/USD`).
- `asset_class`: `stock` or `crypto`.
- `rules`: A list of trigger rules:
  - `id`: Unique identifier (e.g. `aapl_rsi_oversold`). Used to track state and cooldowns in the database.
  - `name`: Human-readable name used in notification titles.
  - `timeframe`: Bar granularity (`1Min`, `5Min`, `15Min`, `1Hour`, `1Day`).
  - `indicator`: Technical indicator to calculate:
    - `RSI` (requires `period` param)
    - `SMA` (requires `period` param)
    - `EMA` (requires `period` param)
    - `SMA_Cross` (requires `fast_period`, `slow_period` params)
    - `EMA_Cross` (requires `fast_period`, `slow_period` params)
    - `MACD` (requires `fast_period`, `slow_period`, `signal_period` params)
    - `MACD_Cross` (requires `fast_period`, `slow_period`, `signal_period` params)
    - `Bollinger_Bands` (requires `period`, `std_dev` params. Sets value: `1.0` for Upper, `0.0` for Middle, `-1.0` for Lower).
  - `condition`:
    - `operator`: `less_than`, `greater_than`, `cross_above`, `cross_below`.
    - `value`: Numerical threshold (optional for crossover rules).
  - `cooldown_seconds`: Minimum spacing between alerts.

---

## Pluggable Notifier Setups

### 👾 Discord
1. Open Server Settings -> Integrations -> Webhooks -> Create Webhook.
2. Copy Webhook URL and paste into `.env` as `DISCORD_WEBHOOK_URL`.
3. Enable `discord` in `config/config.yaml`.

### 💬 Slack
1. Create a Slack App in your workspace and enable "Incoming Webhooks".
2. Add a new Webhook to the desired channel.
3. Paste the URL into `.env` as `SLACK_WEBHOOK_URL` and enable `slack` in your config.

### ✈️ Telegram
1. Contact `@BotFather` on Telegram, send `/newbot`, and copy the API Token.
2. Start a chat with your bot, then check `https://api.telegram.org/bot<TOKEN>/getUpdates` to find your `chat_id`.
3. Save these to `.env` as `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` and enable `telegram` in your config.

---

## Developer Guide & Testing

The project is fully tested. To verify indicator math, crossovers, and state checks:

```bash
# Activate virtual environment
source .venv/bin/activate

# Run test suite
pytest tests/ -v
```

### Repository Layout
- `src/config.py`: Loads YAML and injects environment variables using Pydantic.
- `src/alpaca.py`: Handle REST requests, pagination, and Alpaca data limitations.
- `src/chat.py`: Implements the Ollama-based chat helper that compiles live indicator and database alert context.
- `src/indicators.py`: Contains technical indicator formulas and crossover triggers.
- `src/database.py`: Controls SQLite connection and deduplicates triggers.
- `src/notifier.py`: Prepares payloads and requests webhook endpoints.
- `src/engine.py`: Orchestrates scheduling, loops, and evaluations.

---

## License

This project is licensed under the MIT License - see the LICENSE file for details.
