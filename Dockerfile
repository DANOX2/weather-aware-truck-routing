# syntax=docker/dockerfile:1

# ---- 1. Build the React app -------------------------------------------------
FROM node:24-slim AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- 2. Django API + built frontend -------------------------------------------
FROM python:3.13-slim
COPY --from=ghcr.io/astral-sh/uv:0.13.1 /uv /usr/local/bin/uv

ENV PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PATH="/app/.venv/bin:$PATH" \
    FRONTEND_DIST=/app/frontend_dist \
    DJANGO_DEBUG=0

WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock backend/.python-version ./
RUN uv sync --locked --no-dev --no-install-project

COPY backend/ ./
COPY --from=frontend /frontend/dist /app/frontend_dist
# Pre-compress the frontend (gzip + brotli); WhiteNoise serves the best match per request.
RUN python -m whitenoise.compress /app/frontend_dist \
    && mkdir -p staticfiles \
    && useradd --uid 10001 --create-home app
USER app

# One worker, many threads: requests mostly wait on providers, and a single process
# shares one in-memory cache when no Redis is configured (Cloud Run).
CMD exec gunicorn config.wsgi:application \
    --bind 0.0.0.0:${PORT:-8080} \
    --workers 1 --threads 8 --timeout 60 \
    --access-logfile -
