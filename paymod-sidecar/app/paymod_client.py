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


def derive_address(client_ref: str, chain: str, index: int) -> str:
    """Детерминированная HD-деривация адреса по индексу."""
    paymod = _ensure_paymod()
    # paymod.wallets.derive_user_wallet(seed, path, index) -> (privkey, address)
    _, address = paymod.wallets.derive_user_wallet(
        seed=paymod.config.CONFIG.distributor_seed,
        derivation_path=paymod.config.CONFIG.user_wallet_derivation_path,
        index=index,
    )
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