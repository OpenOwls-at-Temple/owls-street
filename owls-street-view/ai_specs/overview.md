# Owl Street View Dashboard Overview

## Package Objective
`owl-street-view` is the visual dashboard and proxy gateway. It is designed to:
1. Provide a beautiful glassmorphic Web user interface to view market charts, option chains, screener lists, and order panels.
2. Serve compiled React SPA static assets from a FastAPI static file mount.
3. Proxy real-time data from Alpaca API and corporate fundamental metrics from Financial Modeling Prep (FMP) API.
4. Proxy AI chat prompts directly to the alert engine LLM pipeline (`owl-street-pulse`) on port 8000.

## Monorepo Context
The service operates on port 8080. It reads keys and authentication passwords from `.env`. The frontend React code is built using Vite/ESBuild and compiled assets are stored in `frontend/build/` to be served by the FastAPI router.
