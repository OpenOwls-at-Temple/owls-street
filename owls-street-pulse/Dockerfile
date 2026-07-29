# Production Dockerfile
FROM python:3.12-slim

# Prevent writing pyc files and buffer stdout/stderr for immediate log visibility
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

WORKDIR /app

# Install system dependencies (curl for the healthcheck)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy application source
COPY src/ ./src/
COPY config/ ./config/
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Create folders for database state and log output
RUN mkdir -p data logs && chmod +x /usr/local/bin/docker-entrypoint.sh

# Setup secure non-root user
RUN useradd -u 1000 appuser && \
    chown -R appuser:appuser /app

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD curl -fsS http://localhost:8000/api/status || exit 1

# Entrypoint seeds config/config.yaml when absent, then launches daemon mode
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["python", "src/main.py", "--config", "config/config.yaml", "--db", "data/alerts.db", "--host", "0.0.0.0", "--port", "8000"]
