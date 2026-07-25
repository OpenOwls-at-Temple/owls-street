# Owl Street Pulse Progress

Tracks the development progress of features in the technical indicator, alerting, and AI chatbot backend.

## Feature Status Checklist

- [x] **Alpaca Client & Ingestion**
  - [x] Batched symbol requests by timeframe
  - [x] Custom page/bar limit parsing
  - [x] Handling REST rate limits and retries
- [x] **Technical Math & Triggers**
  - [x] Optimized vector SMA and EMA
  - [x] RSI with Wilder's smoothing
  - [x] MACD line, Signal line, and Histogram
  - [x] Bollinger Bands (Upper, Middle, Lower)
  - [x] Vector-based Crossover operators (`cross_above`, `cross_below`)
- [x] **SQLite State Engine**
  - [x] Candle tracking schema to enforce one alert per candle
  - [x] Cooldown checks logic
  - [x] Rotation/cleanup logs structure
- [x] **Pluggable Webhook Notifiers**
  - [x] Console/stdout output formatting
  - [x] Discord color-coded embed generation
  - [x] Slack layout blocks building
  - [x] Telegram text bot API execution
- [x] **Owl Speaks Chat Assistant**
  - [x] Connecting to local Ollama API
  - [x] Context compiler (live pricing + SQLite historical triggers)
  - [x] Custom agent system prompt styling
- [x] **FastAPI Daemon Dashboard**
  - [x] Logging endpoint proxy
  - [x] Rule dashboard monitoring UI
  - [x] System settings reload
