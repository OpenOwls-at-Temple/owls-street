# Project Conventions & Standards Spec

## Python Conventions (Backends)

1. **Python Version**: 3.9+ with strict typing annotations where possible.
2. **Settings**: Use `Pydantic` models for loading configurations and environment variables.
3. **HTTP Server**: Use FastAPI. Organize route controllers cleanly in a dedicated `web.py` router or separate endpoints files.
4. **Logging**: All execution flows should log details to both Console and `logs/app.log` using a Rotating File Handler.
5. **Testing**: Use `pytest`. Test suites are placed in `tests/` directories. Always run tests using `pytest tests/` within the virtual environment (`.venv`).

## Frontend Conventions (React)

1. **Framework**: React Single Page Application compiled via Vite/ESBuild.
2. **Styling**: 
   * Use vanilla CSS (in `theme.css` or component-specific stylesheets) to implement a premium glassmorphic dark theme.
   * Do not use TailwindCSS unless explicitly requested by the user.
   * Focus on responsive CSS Flexbox and Grid layouts.
3. **Components**: Functional components only, utilizing standard React Hooks (`useState`, `useEffect`, `useRef`).
4. **Proxy**: React is configured to proxy API requests in local development directly to the backend proxy port (port 8080).

## Repository Management

1. **Virtual Environments**: Always isolate Python dependency resolution inside local `.venv` directories inside each package.
2. **Environment Variables**: Use `.env` files for localized secrets (Alpaca keys, FMP keys, Discord/Slack URLs). Never commit `.env` or any sensitive JSON files to git control.
