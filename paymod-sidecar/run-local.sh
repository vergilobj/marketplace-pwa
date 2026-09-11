#!/bin/bash
# J1 — локальный запуск paymod sidecar (инфраструктурный раннер, не прод-код).
# Грузит .env и стартует uvicorn на 127.0.0.1:8100.
set -e

DIR="/Users/vergilobj/marketplace-pwa/paymod-sidecar"
cd "$DIR"

set -a
# shellcheck disable=SC1091
. "$DIR/.env"
set +a

exec "$DIR/venv/bin/python" -m uvicorn app.main:app \
  --host 127.0.0.1 --port 8100