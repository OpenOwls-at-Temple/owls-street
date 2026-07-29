# ── Stage 1: compile the React SPA ────────────────────────────────────────────
FROM node:20-slim AS frontend

WORKDIR /build

# Install against the lockfile first so this layer caches independently of source edits
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY frontend/ ./
RUN npm run build


# ── Stage 2: Python runtime serving the API and the compiled SPA ──────────────
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

WORKDIR /app

# curl for the healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

COPY src/ ./src/
COPY config/ ./config/

# web.py looks for the bundle at <project root>/frontend/build and falls back to an
# API-only mode if it is missing, so the path here matters.
COPY --from=frontend /build/build ./frontend/build

RUN mkdir -p logs

RUN useradd -u 1000 appuser && \
    chown -R appuser:appuser /app

USER appuser

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD curl -fsS http://localhost:8080/api/status || exit 1

CMD ["python", "src/main.py", "--config", "config/config.yaml", "--host", "0.0.0.0", "--port", "8080"]
