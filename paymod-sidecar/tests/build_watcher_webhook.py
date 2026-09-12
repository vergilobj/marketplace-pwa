#!/usr/bin/env python
"""H1 — живое доказательство: payload для webhook'а собирает САМ background.py.

Не тест-хелпер «с правильным полем», а реальная функция: скрипт вызывает
`app.background._on_deposit` с deposit-словарём вида `paymod.watcher._handle_log`
и перехватывает то, что функция отправляет в webhook. Подпись HMAC считается
тем же кодом, что и в сервисе (`app.auth.hmac_sign_headers`).

stdout: JSON {"payload", "body", "timestamp", "signature"}
  body — ровно те байты, что ушли бы по HTTP: `json.dumps(payload)` (как в
  `background._post_webhook`). Backend проверяет HMAC по сырому телу, поэтому
  интеграционный тест обязан отправить ИМЕННО эту строку.

usage: python tests/build_watcher_webhook.py '<deposit-json>'
"""
from __future__ import annotations

import asyncio
import json
import os
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# То же окружение, что у сервиса (run-local.sh / paymod.service): PAYMOD_DIR,
# PAYMOD_SHARED_SECRET, DB_PATH берутся из .env sidecar.
_env_file = ROOT / ".env"
if _env_file.exists():
    for _raw in _env_file.read_text(encoding="utf-8").splitlines():
        _line = _raw.strip()
        if not _line or _line.startswith("#") or "=" not in _line:
            continue
        _k, _v = _line.split("=", 1)
        os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))

from app import background  # noqa: E402
from app.auth import hmac_sign_headers  # noqa: E402


async def _build(deposit: dict) -> dict:
    """Собирает webhook ровно так, как это делает боевой sidecar.

    ⚠️ J3: в проде paymod.db инициализируется в `main.py::lifespan`
    (`paymod.db.init_db()`) ДО старта background-тасков. Без этого
    `_resolve_to_address` не может достать выданный адрес и `to` уходит
    пустым. Харнесс обязан воспроизводить прод-условия, иначе он проверяет
    не то, что крутится в бою — поэтому init_db здесь обязателен.
    """
    import paymod.db as paymod_db

    await paymod_db.init_db()
    sent: list[dict] = []

    async def fake_post(payload: dict) -> None:
        sent.append(payload)

    background._post_webhook = fake_post  # type: ignore[assignment]
    try:
        await background._on_deposit(deposit)
    finally:
        await paymod_db.close_db()

    if len(sent) != 1:
        raise RuntimeError(f"expected 1 webhook, got {len(sent)}")
    return sent[0]


def main() -> int:
    deposit = json.loads(sys.argv[1])
    try:
        payload = asyncio.run(_build(deposit))
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": str(exc)}))
        return 1

    body = json.dumps(payload)
    headers = hmac_sign_headers(
        os.environ["PAYMOD_SHARED_SECRET"].encode("utf-8"), body.encode("utf-8")
    )
    print(
        json.dumps(
            {
                "payload": payload,
                "body": body,
                "timestamp": headers["X-Paymod-Timestamp"],
                "signature": headers["X-Paymod-Signature"],
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())