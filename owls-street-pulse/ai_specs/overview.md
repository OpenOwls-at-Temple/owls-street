# Owl Street Pulse Backend Overview

## Package Objective
`owl-street-pulse` is a FastAPI-powered background worker and API service designed to:
1. Ingest asset pricing data from the Alpaca API in batched requests.
2. Evaluate configured technical indicator criteria (RSI, Moving Averages, MACD, Bollinger Bands).
3. Dispatch real-time, non-duplicate notifications to Discord, Slack, and Telegram channels.
4. Host the `Owl Speaks` AI agent, which uses a local Ollama model to answer questions by analyzing database logs and live market statistics.

## Monorepo Context
The service operates on port 8000. It reads rules from `config/config.yaml` and logs state to a local SQLite database (`data/alerts.db`). It serves as the primary LLM provider; the dashboard UI (`owl-street-view`) proxies user chat messages directly to this backend's `/api/chat` router.
