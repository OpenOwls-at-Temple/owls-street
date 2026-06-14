# Production Dockerfile
FROM python:3.9-slim

# Prevent writing pyc files and buffer stdout/stderr for immediate log visibility
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

WORKDIR /app

# Install system dependencies (curl for optional debugging/healthchecks)
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

# Create folders for database state and log output
RUN mkdir -p data logs

# Setup secure non-root user
RUN useradd -u 1000 appuser && \
    chown -R appuser:appuser /app

USER appuser

# Executable command to launch daemon mode
CMD ["python", "src/main.py", "--config", "config/config.yaml", "--db", "data/alerts.db"]
