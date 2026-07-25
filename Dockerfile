# Monorepo root Dockerfile for Railway (build context = repo root).
# Local backend-only build: cd backend && docker build -t gastro-api .
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8001

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Prefer root copy (Railway context = repo root); keep in sync with backend/requirements-prod.txt
COPY requirements-prod.txt .
RUN pip install --upgrade pip && pip install -r requirements-prod.txt

COPY backend/ .

EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" || exit 1

CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT:-8001}"]
