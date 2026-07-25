# Owl Street View Dashboard Features

This document provides details on the main user interface features of the trading dashboard.

## Live Quote Streaming
* **React Client WebSocket**: Connects to the backend via `/ws/quotes`.
* **Streaming Protocol**: Subscribes to live price tickers and updates the dashboard values dynamically.

## Advanced Charting
* **Component**: Uses TradingView `lightweight-charts` to plot high-performance canvas candles.
* **Overlays**: Supports volume bar plots at the bottom of the chart.
* **Customization**: Offers timeframe resolution selectors (1Min, 5Min, 15Min, 1Hour, 1Day).

## Options Chain Matrix
* **Table Layout**: Central strike column with Call option metrics on the left and Put metrics on the right.
* **Key Indicators**: Renders bid/ask quotes, last-trade prices, Implied Volatility (IV%), and Greeks (Delta, Gamma, Theta, Vega).

## Stock Screener
* **Data Sources**: Integrates Alpaca Markets API snapshots with Financial Modeling Prep (FMP) APIs.
* **Filters**: Supports sorting stocks by market cap, P/E ratio, EPS growth, and revenue growth. Refer to [SCREENER.md](./SCREENER.md) for endpoint parameters.

## Order Entry Panel
* **Forms**: Submits market, limit, stop, stop-limit, trailing stop, bracket (take profit + stop loss), OCO, and OTO orders.
* **Portfolio Control**: Displays active positions and provides buttons to close positions immediately.

## Auth Lockscreen Overlay
* **Session Locking**: Frontend gates dashboard views using a password prompt.
* **Server Verification**: Handled via simple token validation against backend sessions.

## Owl Speaks Chat Component
* **Component**: `OwlSpeaksChat.jsx` provides an interactive chatbot window.
* **Data Flow**: Proxies client requests to the FastAPI backend `/api/chat` router, which delegates model context compilation to the Pulse backend.
