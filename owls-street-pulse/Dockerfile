# Production Dockerfile
FROM python:3.12-slim

# Prevent writing pyc files and buffer stdout/stderr for immediate log visibility
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

WORKDIR /app

# Install system dependencies (curl for the healthcheck). setpriv comes from util-linux and
# is what the entrypoint uses to drop privileges; assert it exists now so a missing binary
# fails the build rather than the container.
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && command -v setpriv

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

# Setup non-root user. No USER directive: the entrypoint drops to appuser itself, which
# lets it first take ownership of a volume that a platform mounted as root.
RUN useradd -u 1000 appuser && \
    chown -R appuser:appuser /app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD curl -fsS "http://localhost:${PORT:-8000}/api/status" || exit 1

# Shell form so PORT and the path overrides expand at runtime. main.py re-exports --config
# and --db into the environment for web.py, so they must be passed, not just set as env.
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["sh", "-c", "exec python src/main.py --config \"${WEB_CONFIG_PATH:-config/config.yaml}\" --db \"${WEB_DB_PATH:-data/alerts.db}\" --host 0.0.0.0 --port \"${PORT:-8000}\""]
