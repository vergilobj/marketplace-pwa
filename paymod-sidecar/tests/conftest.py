"""Прогон тестов sidecar в ТОМ ЖЕ окружении, что и сервис.

`run-local.sh` / `paymod.service` стартуют uvicorn с `set -a; . .env` —
без этого `PAYMOD_DIR` не задан и ленивый импорт paymod не работает
(`paymod.config` требует свой .env). Тесты обязаны видеть ту же
конфигурацию, иначе они проверяют не то, что крутится в проде.
"""
from __future__ import annotations

import os
import pathlib

_ENV_FILE = pathlib.Path(__file__).resolve().parent.parent / ".env"


def pytest_configure() -> None:
    if not _ENV_FILE.exists():
        return
    for raw in _ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))