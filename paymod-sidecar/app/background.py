"""Фоновые asyncio-таски: watcher (детект депозитов) и sweeper (свип на казну).

Оба колбэка вызываются из paymod-циклов; on_deposit шлёт webhook в NestJS,
on_sweep_result — информативный webhook (не блокирует бизнес-логику).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any, Awaitable, Callable

import aiohttp

from .auth import hmac_sign_headers
from .paymod_client import _ensure_paymod

logger = logging.getLogger("paymod-sidecar.background")

WEBHOOK_URL_DEFAULT = os.environ.get(
    "PAYMOD_WEBHOOK_URL", "http://127.0.0.1:3000/payments/paymod/webhook"
)


def _secret() -> bytes:
    value = os.environ.get("PAYMOD_SHARED_SECRET", "")
    if not value:
        raise RuntimeError("PAYMOD_SHARED_SECRET is not set")
    return value.encode("utf-8")


async def _post_webhook(payload: dict[str, Any]) -> None:
    """Отправляет подписанный webhook в NestJS. Не бросает исключений наружу."""
    url = os.environ.get("PAYMOD_WEBHOOK_URL", WEBHOOK_URL_DEFAULT)
    raw = json.dumps(payload).encode("utf-8")
    headers = hmac_sign_headers(_secret(), raw)
    try:
        timeout = aiohttp.ClientTimeout(total=15)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(url, data=raw, headers=headers) as resp:
                if resp.status >= 400:
                    logger.warning(
                        "webhook failed: %s status=%s body=%s",
                        url,
                        resp.status,
                        await resp.text(),
                    )
                else:
                    logger.info("webhook delivered: %s", payload.get("event"))
    except Exception as exc:  # noqa: BLE001
        logger.error("webhook exception: %s", exc)


async def _on_deposit(deposit: dict[str, Any]) -> None:
    """Колбэк paymod.run_watcher: конвертирует депозит в webhook-событие deposit."""
    # paymod отдаёт deposit с полями: chain_id, tx_hash, log_index, token,
    # token_address, from, to, amount (raw/atomic), block_number, wallet/client_ref.
    client_ref = deposit.get("client_ref") or deposit.get("wallet_id") or ""
    chain_id = deposit.get("chain_id") or deposit.get("chain") or ""
    payload = {
        "event": "deposit",
        "client_ref": client_ref,
        "chain": str(chain_id).lower(),
        "token": deposit.get("token") or deposit.get("symbol") or "",
        "token_address": deposit.get("token_address", ""),
        "tx_hash": deposit.get("tx_hash", ""),
        "from": deposit.get("from", ""),
        "to": deposit.get("to", ""),
        "amount": deposit.get("amount", ""),
        "amount_raw": str(deposit.get("amount_raw", "")),
        "block_number": deposit.get("block_number"),
    }
    logger.info("deposit detected: ref=%s tx=%s", client_ref, payload["tx_hash"])
    await _post_webhook(payload)


async def _on_sweep_result(result: dict[str, Any]) -> None:
    """Колбэк paymod.run_sweeper: информативный webhook sweep.confirmed."""
    payload = {
        "event": "sweep.confirmed",
        "chain": str(result.get("chain_id", "")).lower(),
        "tx_hash": result.get("tx_hash", ""),
        "from": result.get("from", ""),
        "to": result.get("to", ""),
        "amount_raw": str(result.get("amount_raw", "")),
    }
    logger.info("sweep result: tx=%s", payload["tx_hash"])
    await _post_webhook(payload)


async def start_background_tasks() -> None:
    """Запускает run_watcher и run_sweeper как фоновые asyncio-таски."""
    paymod = _ensure_paymod()

    async def _watcher() -> None:
        while True:
            try:
                await paymod.run_watcher(_on_deposit)
            except Exception as exc:  # noqa: BLE001
                logger.exception("watcher crashed, restarting: %s", exc)
                await asyncio.sleep(5)

    async def _sweeper() -> None:
        while True:
            try:
                await paymod.run_sweeper(_on_sweep_result)
            except Exception as exc:  # noqa: BLE001
                logger.exception("sweeper crashed, restarting: %s", exc)
                await asyncio.sleep(5)

    asyncio.create_task(_watcher())
    asyncio.create_task(_sweeper())
    logger.info("background paymod tasks started (watcher + sweeper)")


def build_on_deposit(webhook: Callable[[dict[str, Any]], Awaitable[None]]) -> Callable:
    """Фабрика колбэка для тестирования (инъекция webhook-функции)."""
    return _on_deposit


def build_on_sweep_result(webhook: Callable[[dict[str, Any]], Awaitable[None]]) -> Callable:
    return _on_sweep_result