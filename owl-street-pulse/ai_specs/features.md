# Owl Street Pulse Backend Features

This document provides details on the main features of the alert and chat engine.

## Batched Market Data Ingestion
* To maximize API efficiency and avoid hitting Alpaca API rate limits, the ingestion engine groups monitored symbols by their timeframe (e.g. `15Min` or `1Day`).
* Symbols are requested in batches using `alpaca-py` SDK REST endpoints, retrieving historical bars for analysis.

## Technical Indicator Calculations & Triggers
* **SMA/EMA**: Standard rolling vectors.
* **RSI**: Calculated using Wilder's smoothed average of gains and losses.
* **MACD**: Calculates fast/slow averages, signals, and histograms.
* **Bollinger Bands**: Outlines volatility bounds.
* **Crossover Logic**: Compares current and previous vector entries to ensure indicator intersections (like MACD line crossing above signal line) only alert on the initial cross event.

## SQLite State Deduplication
* The SQLite DB (`alerts.db`) tracks triggered events.
* **One alert per candle rule**: When a rule fires, the engine stores the record of the symbol, rule ID, and the timestamp of the bar's start. Consecutive evaluations of the same bar are skipped.
* **Cooldown constraint**: Fired alerts respect the `cooldown_seconds` setting. No alerts are dispatched until the cooldown period expires.

## Pluggable Webhook Notifiers
* Supports simultaneous dispatch of formatting payloads:
  * **Discord**: Rich embeds with colored indicators (e.g., green for buy/oversold, red for sell/overbought).
  * **Slack**: Block Kit structures with markdown text blocks.
  * **Telegram**: Direct text API queries using standard bot credentials.
  * **Console**: Color-coded standard output logs.

## Owl Speaks Chat Agent
* **Local Ollama Integration**: Communicates with models like `llama3.1` running on `http://localhost:11434`.
* **Context building**: Before sending a prompt to Ollama, the server retrieves:
  1. The symbol's historical alert logs from SQLite.
  2. Live ticker snapshot and pricing indicators from Alpaca.
* **Prompt template**: Combines these data sources into a detailed, structured prompt so the LLM provides an accurate technical analysis.
