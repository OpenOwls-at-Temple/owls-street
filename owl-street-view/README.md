# Owl Street View

A free, self-hosted trading dashboard built with **alpaca-py** (FastAPI backend) and **React** (frontend), designed with a high-fidelity glassmorphic dark theme inspired by **Owl Street Pulse**.

Serves both backend API endpoints and compiled static frontend assets from a single unified server.

---

## Features
- **Live Streaming Quotes**: Real-time pricing via Alpaca WebSockets.
- **Advanced Charting**: Candlestick/line chart with volume overlays, drawings, and indicator tools powered by TradingView `lightweight-charts`.
- **Options Chain Matrix**: Interactive options chain pairing calls/puts, displaying IV%, greeks, and last-trade prices.
- **Data Screener**: Scan US equities using snapshots and FMP fundamental filters (market cap, P/E, EPS/revenue growth).
- **Order Panel & History**: Submit market, limit, stop, stop-limit, trailing stop, bracket (take profit & stop loss), OCO, and OTO orders.
- **Auth Lockscreen Overlay**: Dashboard locking mechanism gated by a password.

---

## Quick Start

### 1. Get free Alpaca API keys
Sign up at [alpaca.markets](https://alpaca.markets) → Paper Trading → API Keys.

### 2. Setup and Launch the Dashboard
The `run.sh` script handles everything for you. It automatically copies example configurations (`.env.example` -> `.env` and `config.yaml.example` -> `config.yaml`), creates a Python virtual environment, installs dependencies, compiles the React frontend assets, and starts the FastAPI server.

Run the script from the project root:
```bash
./run.sh
```

You can customize the host, port, or configuration file by passing arguments to the launcher:
```bash
./run.sh --port 8081 --host 0.0.0.0
```

Once started, open **[http://localhost:8080](http://localhost:8080)** (or your custom port) in your browser. Fill in your Alpaca API credentials in the generated `.env` file.

---

## Development Workflow
For active frontend development with hot-reloading:
1. Run the backend server using the launcher in one terminal:
   ```bash
   ./run.sh
   ```
2. Run the React development server in a second terminal:
   ```bash
   cd frontend
   npm start
   ```
   *Note: React scripts are pre-configured to proxy API requests to the FastAPI backend at `http://localhost:8080`.*

---

## Project Structure
```
owl-street-view/
├── config/
│   ├── config.yaml          # YAML settings configuration
│   └── config.yaml.example
├── frontend/
│   ├── build/               # Output directory for compiled React static assets
│   ├── public/              # Public HTML templates
│   └── src/                 # React codebases & components
├── src/                     # FastAPI Modular Python backend
│   ├── main.py              # CLI bootstrap entry point
│   ├── web.py               # REST API routers & WebSocket quotes streams
│   ├── config.py            # Pydantic validation parsing
│   └── alpaca_service.py    # Wrapper classes for Alpaca and FMP APIs
├── requirements.txt
└── .env.example
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Authenticate dashboard session |
| POST | `/api/auth/logout` | Clear authenticated session |
| GET | `/api/status` | Read server and authorization state |
| GET | `/api/account` | Retrieve account info |
| GET | `/api/positions` | List open portfolio positions |
| POST | `/api/positions/close` | Close specific position |
| GET | `/api/orders` | Read order book logs |
| POST | `/api/orders/submit` | Submit advanced order (simple/bracket/OCO/OTO) |
| DELETE | `/api/orders/{id}` | Cancel active order |
| GET | `/api/quote/{symbol}` | Read latest bid/ask quotes |
| GET | `/api/snapshot/{symbol}` | Read trade/quote snapshot |
| GET | `/api/bars/{symbol}` | Fetch historical bar data |
| GET | `/api/option-expirations/{underlying}` | List active contract expirations |
| GET | `/api/option-chain-matrix/{underlying}` | Fetchpaired call/put chain matrix |
| POST | `/api/screener` | Run stock fundamentals screener |
| WS | `/ws/quotes` | Subcribe to real-time quotes WebSocket |
