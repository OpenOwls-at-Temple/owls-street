# Owl Street View Progress

Tracks the development progress of frontend dashboard views and backend API routes.

## Feature Status Checklist

- [x] **Live Pricing Stream**
  - [x] WebSocket connection client in React (`/ws/quotes`)
  - [x] Live quotes updates from Alpaca streaming channel
- [x] **Technical Charting**
  - [x] TradingView `lightweight-charts` component setup
  - [x] Volume overlay plotting
  - [x] Dynamic timeframes selection (1M, 5M, 15M, 1H, 1D)
- [x] **Options Chain Matrix**
  - [x] Paired Call and Put chain layouts
  - [x] Calculations/display for Implied Volatility (IV)
  - [x] Greeks values display (Delta, Gamma, Theta, Vega)
- [x] **Stock Screener**
  - [x] Alpaca market snapshots merge
  - [x] Financial Modeling Prep (FMP) API filter checks (market cap, P/E ratio, growth)
  - [x] Search, sorting, and tabular lists UI
- [x] **Orders & Account Execution**
  - [x] Gated credentials/account information views
  - [x] Order forms submission panel (limit, stop-limit, trailing stop, bracket, OCO/OTO)
  - [x] Active positions and order book log widgets
- [x] **Dashboard Safety overlay**
  - [x] Frontend Auth Password Overlay lock
  - [x] Local token session tracking
- [x] **Owl Speaks Chat Component**
  - [x] `OwlSpeaksChat.jsx` chat interface
  - [x] Session message rendering
  - [x] Proxying chat requests to Pulse backend `/api/chat`
