# Owl Street Pulse Backend Architecture

This document outlines the codebase organization and database schemas of the alerting service.

## Core Code Modules (`src/`)

* **[config.py](file:///Users/arbaz/projects/owls-street/owl-street-pulse/src/config.py)**: Defines Pydantic configuration schemas for Alpaca, Notifiers, and Rule Monitors, parsing `config/config.yaml` and replacing dynamic `${ENV}` tags.
* **[alpaca.py](file:///Users/arbaz/projects/owls-street/owl-street-pulse/src/alpaca.py)**: Initializes connection to the Alpaca API, handles REST request pagination, and formats ticker bars.
* **[indicators.py](file:///Users/arbaz/projects/owls-street/owl-street-pulse/src/indicators.py)**: Vectorized computations for mathematical indicators (SMA, EMA, RSI, MACD, Bollinger Bands) and boolean crossovers.
* **[database.py](file:///Users/arbaz/projects/owls-street/owl-street-pulse/src/database.py)**: Manages the SQLite database file, creates tables, registers triggered alerts, and handles cooldown/candle queries.
* **[notifier.py](file:///Users/arbaz/projects/owls-street/owl-street-pulse/src/notifier.py)**: Prepares message payloads and sends them to active Discord, Slack, and Telegram channels.
* **[chat.py](file:///Users/arbaz/projects/owls-street/owl-street-pulse/src/chat.py)**: Forms prompts containing historical context from the SQLite database and live ticker pricing, sending them to the Ollama LLM.
* **[engine.py](file:///Users/arbaz/projects/owls-street/owl-street-pulse/src/engine.py)**: Houses the active polling scheduler loop. Runs indicator calculations and dispatches checks.
* **[web.py](file:///Users/arbaz/projects/owls-street/owl-street-pulse/src/web.py)**: Sets up the FastAPI server, endpoints to view logs, endpoints to test rules, and the Ollama chat socket.

## Database Schema (SQLite)

The system automatically initializes tables in the SQLite database file.

### `alert_logs` Table
Tracks triggered alerts:
* `id` (INTEGER, PRIMARY KEY): Unique log index.
* `rule_id` (TEXT): The rule ID specified in `config.yaml`.
* `symbol` (TEXT): The asset ticker.
* `name` (TEXT): Rule name description.
* `indicator` (TEXT): Math indicator type used.
* `condition` (TEXT): Operator condition evaluated (e.g. `less_than`).
* `value` (REAL): Numerical trigger limit.
* `triggered_at` (TEXT): ISO-8601 timestamp of alert dispatch.
* `candle_timestamp` (TEXT): Start timestamp of the candle bar that triggered the alert.

### `rule_state` Table (Optional/State cache)
* Tracks cooldown states and last-fired timestamps for rules to quickly optimize scheduling logic.
