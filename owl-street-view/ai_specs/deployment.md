# Owl Street View Dashboard Deployment

This document describes how the trading dashboard is compiled, served, and run.

## Production Single-Port Serving

In production environments, both the React frontend and FastAPI backend are served from a single unified port:
1. **Compilation Step**: The build script runs `npm install` and `npm run build` inside the `frontend/` directory. This outputs static HTML/JS/CSS assets to `frontend/build/`.
2. **Mounting Step**: The FastAPI application (`src/web.py`) mounts this static assets folder:
   ```python
   app.mount("/", StaticFiles(directory="frontend/build", html=True), name="static")
   ```
3. **Launch**: Running the backend server on port `8080` allows the user to access the dashboard by visiting `http://localhost:8080/`.

## Local Development (Hot Reloading)

For UI updates, running frontend and backend servers separately is recommended:
* **Backend**: Run `./run.sh` to start the REST API on port `8080`.
* **Frontend**: Navigate to `frontend/` and run `npm start` (or `npm run dev`).
  * Vite is configured to proxy all `/api/*` and `/ws/*` requests to `http://localhost:8080`.
  * Allows active HMR (Hot Module Replacement) updates in the browser.

## Custom Arguments
The startup script `run.sh` supports:
* `--port <number>`: Selects binding port (default `8080`).
* `--host <address>`: Selects binding host (default `0.0.0.0`).
* `--config <filepath>`: Selects YAML configuration file (default `config/config.yaml`).
