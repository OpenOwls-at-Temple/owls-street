# Owl Street View Dashboard Architecture

This document details the frontend and backend codebase structure for the trading dashboard.

## Codebase Structure

### Python Backend (`src/`)
* **[config.py](file:///Users/arbaz/projects/owls-street/owl-street-view/src/config.py)**: Loads settings from `config/config.yaml` using Pydantic.
* **[alpaca_service.py](file:///Users/arbaz/projects/owls-street/owl-street-view/src/alpaca_service.py)**: Standardizes integration with Alpaca for fetching options, submitting orders, and retrieving fundamentals from FMP.
* **[web.py](file:///Users/arbaz/projects/owls-street/owl-street-view/src/web.py)**:
  * Rest API routers for portfolio/order controls.
  * Chat Proxy endpoint: Maps POST requests to `/api/chat` and redirects them to the Pulse Alert server (typically at `http://localhost:8000/api/chat`).
  * WebSocket broker: Proxies real-time pricing streams under `/ws/quotes`.

### React Frontend (`frontend/src/`)
* **[components/](file:///Users/arbaz/projects/owls-street/owl-street-view/frontend/src/components/)**:
  * `Chart.jsx`: TradingView charting component.
  * `OptionChainMatrix.jsx`: Option matrix with Greeks.
  * `Screener.jsx`: Fundamental screening controls.
  * `OwlSpeaksChat.jsx`: Chat interaction interface.
  * `Lockscreen.jsx`: Password gates dashboard contents.
* **[theme.css](file:///Users/arbaz/projects/owls-street/owl-street-view/frontend/src/theme.css)**: Shared CSS variables for colors, blur effects, glassmorphic card boundaries, and scroll styling.

## CSS Styling Tokens
The frontend implements a glassmorphism aesthetic using the following CSS tokens in `theme.css`:
* **Backgrounds**: Translucent dark colors with backdrop filters:
  ```css
  background: rgba(20, 20, 25, 0.7);
  backdrop-filter: blur(12px);
  ```
* **Borders**: Translucent borders to give container edges a glass reflection:
  ```css
  border: 1px solid rgba(255, 255, 255, 0.08);
  ```
* **Typography**: Outfit/Inter font imports with variable weights.
