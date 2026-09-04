"""HMAC-аутентификация для sidecar.

Подпись: base64( HMAC-SHA256( secret, timestamp + "." + raw_body ) ).
Окно допустимости — 60 секунд (анти-replay).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import time
from typing import Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse


def _secret() -> bytes:
    """Читает PAYMOD_SHARED_SECRET из окружения процесса."""
    value = os.environ.get("PAYMOD_SHARED_SECRET", "")
    if not value:
        raise RuntimeError("PAYMOD_SHARED_SECRET is not set")
    return value.encode("utf-8")


def sign(secret: bytes, timestamp: str, raw_body: bytes) -> str:
    """Вычисляет подпись запроса/ответа."""
    message = f"{timestamp}.{raw_body.decode('utf-8')}".encode("utf-8")
    digest = hmac.new(secret, message, hashlib.sha256).digest()
    return base64.b64encode(digest).decode("ascii")


def verify_signature(secret: bytes, timestamp: str, raw_body: bytes, signature: str) -> bool:
    """Сравнивает подпись через hmac.compare_digest."""
    if not signature or not timestamp:
        return False
    expected = sign(secret, timestamp, raw_body)
    return hmac.compare_digest(expected, signature)


def verify_timestamp(timestamp: str, window_seconds: int = 60) -> bool:
    """Проверяет, что timestamp не старше window_seconds (анти-replay)."""
    try:
        ts = int(timestamp)
    except (TypeError, ValueError):
        return False
    return abs(int(time.time()) - ts) <= window_seconds


class HmacAuthMiddleware(BaseHTTPMiddleware):
    """Middleware, требующий валидную HMAC-подпись на входящих запросах.

    Исключение — GET /v1/health (liveliness, без подписи) и OPTIONS.
    """

    def __init__(self, app, secret: bytes | None = None, window_seconds: int = 60):
        super().__init__(app)
        self._secret = secret
        self._window = window_seconds

    @property
    def secret(self) -> bytes:
        if self._secret is None:
            self._secret = _secret()
        return self._secret

    async def dispatch(self, request: Request, call_next: Callable):
        path = request.url.path
        if request.method == "GET" and path == "/v1/health":
            return await call_next(request)
        if request.method == "OPTIONS":
            return await call_next(request)

        timestamp = request.headers.get("X-Paymod-Timestamp", "")
        signature = request.headers.get("X-Paymod-Signature", "")
        raw_body = await request.body()

        if not verify_timestamp(timestamp, self._window):
            return JSONResponse(
                {"detail": "stale or missing timestamp"},
                status_code=401,
            )
        if not verify_signature(self.secret, timestamp, raw_body, signature):
            return JSONResponse(
                {"detail": "invalid signature"},
                status_code=401,
            )

        # Повторно кладём тело в запрос, чтобы маршруты могли его прочитать.
        async def receive():
            return {"type": "http.request", "body": raw_body, "more_body": False}

        request._receive = receive
        return await call_next(request)


def hmac_sign_headers(secret: bytes, raw_body: bytes) -> dict[str, str]:
    """Формирует заголовки для исходящего подписанного запроса (webhook)."""
    timestamp = str(int(time.time()))
    return {
        "X-Paymod-Timestamp": timestamp,
        "X-Paymod-Signature": sign(secret, timestamp, raw_body),
        "Content-Type": "application/json",
    }