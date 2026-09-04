"""Вызовы paymod: HD-деривация адресов и выплаты из казны.

Ленивый импорт paymod по PAYMOD_DIR (как в agentbox paymod_client.py).
"""
from __future__ import annotations

import os
import sys
from typing import Any, Optional

_paymod: Any = None


def _ensure_paymod() -> Any:
    """Лениво импортирует paymod из PAYMOD_DIR (sys.path), грузит его .env."""
    global _paymod
    if _paymod is not None:
        return _paymod

    paymod_dir = os.environ.get("PAYMOD_DIR", "")
    if paymod_dir and paymod_dir not in sys.path:
        sys.path.insert(0, paymod_dir)

    # paymod сам грузит свой .env через dotenv.load_dotenv() при импорте config.
    import paymod  # noqa: F401
    # Явно импортируем подмодули — иначе paymod.chain/config/wallets
    # недоступны как атрибуты пакета (__init__ экспортирует не всё).
    import paymod.chain  # noqa: F401
    import paymod.config  # noqa: F401
    import paymod.db  # noqa: F401
    import paymod.wallets  # noqa: F401

    _paymod = paymod
    return _paymod


async def get_or_create_wallet(client_ref: str, ttl_seconds: int | None = None) -> str:
    """Выдаёт адрес клиенту через paymod.db.create_deposit_wallet (кладёт в wallets).

    ВАЖНО: watcher сканирует именно paymod.db.wallets (wallet_directory).
    Собственная sidecar-таблица derived_wallets watcher'у не видна — потому
    выдача адреса обязана идти через paymod, иначе депозиты не детектятся.
    Идемпотентно по client_ref (уникальный в wallets).
    """
    paymod = _ensure_paymod()
    # Повторный запрос того же client_ref → тот же адрес.
    directory = await paymod.db.wallet_directory()
    for row in directory:
        if row["client_ref"] == client_ref:
            return row["address"]
    _, address, _ = await paymod.db.create_deposit_wallet(client_ref, ttl_seconds)
    return address


async def pay_erc20(
    network: str,
    token: str,
    to_address: str,
    amount_raw: int,
) -> tuple[Optional[str], bool]:
    """Выплата ERC-20 из казны (распределителя). Возвращает (tx_hash, ok)."""
    paymod = _ensure_paymod()
    tx_hash, ok = await paymod.chain.pay_erc20_from_distributor(
        network=network,
        token=token,
        to=to_address,
        amount=amount_raw,
        require_balance=True,
    )
    return tx_hash, ok