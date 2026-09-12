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

# ── Контракт с paymod.watcher (H1) ─────────────────────────────────────────
#
# `paymod.watcher._handle_log` кладёт в on_deposit РОВНО эти ключи:
#   wallet_id, client_ref, network, symbol, amount, amount_atomic, tx_hash, is_new
# Ни `amount_raw`, ни `to`, ни `token_address`, ни `chain_id` watcher НЕ отдаёт.
#
# При этом `amount_atomic` — НЕ сырые единицы токена, а human-сумма,
# нормализованная watcher'ом к 6 decimals:
#   amount        = int(log.data, 16) / 10 ** token["decimals"]
#   amount_atomic = int(round(amount * 1_000_000))
# (watcher.py, _handle_log). Маркетплейс же хранит expectedAmountRaw в decimals
# САМОГО токена (`payments.service.ts`: tokenDecimals = 18 для BSC/USDT) —
# значит на границе нужен пересчёт 6 -> token_decimals.
WATCHER_ATOMIC_DECIMALS = 6

# Зеркало pinned-спеки paymod.networks.TOKENS — только фолбэк, когда paymod
# недоступен (юнит-тесты sidecar без PAYMOD_DIR). Рабочий путь — запрос
# decimals у самого paymod (single source of truth).
_FALLBACK_TOKEN_DECIMALS: dict[tuple[str, str], int] = {
    ("BSC", "USDT"): 18,
    ("BASE", "USDC"): 6,
    ("ARBITRUM", "USDT"): 6,
    ("ARBITRUM", "USDC"): 6,
}

# chain_id paymod-сетей -> имя сети, которое ждёт бэкенд (lower-case:
# `payments.service.ts` пишет Transaction.chain = 'bsc').
_NETWORK_CHAIN_NAME: dict[int, str] = {56: "bsc", 8453: "base", 42161: "arbitrum"}


def token_decimals(network: str, token: str) -> int:
    """decimals токена из paymod.networks (single source), с фолбэком на спеку.

    Импорт paymod ленивый: модуль грузит свой .env и падает без него, а
    `_on_deposit` обязан быть вызываемым в юнит-тестах без paymod.
    """
    try:
        paymod = _ensure_paymod()
        spec = paymod.networks.token_spec(network, token)
        if spec:
            return int(spec["decimals"])
    except Exception as exc:  # noqa: BLE001
        logger.debug("paymod token spec unavailable (%s/%s): %s", network, token, exc)
    return _FALLBACK_TOKEN_DECIMALS.get((network.upper(), token.upper()), 18)


def to_chain_raw(amount_atomic: object, decimals: int) -> str:
    """6-decimals `amount_atomic` watcher'а -> raw в decimals токена (строка).

    Для BSC/USDT: factor = 10 ** (18 - 6) = 10**12, т.е. 1 USDT
    (amount_atomic = 1_000_000) -> '1000000000000000000' — ровно то, что
    бэкенд считает ожидаемым (`toRaw(1, 18)`).
    """
    try:
        atomic = int(amount_atomic)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return ""
    if atomic < 0:
        return ""
    if decimals >= WATCHER_ATOMIC_DECIMALS:
        return str(atomic * 10 ** (decimals - WATCHER_ATOMIC_DECIMALS))
    return str(atomic // 10 ** (WATCHER_ATOMIC_DECIMALS - decimals))


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


def _chain_name(deposit: dict[str, Any]) -> str:
    """Имя сети для бэкенда: из chain_id paymod, иначе из network/chain."""
    chain_id = deposit.get("chain_id")
    if isinstance(chain_id, int) and chain_id in _NETWORK_CHAIN_NAME:
        return _NETWORK_CHAIN_NAME[chain_id]
    raw = deposit.get("chain") or deposit.get("network") or ""
    return str(raw).lower()


def _token_address(deposit: dict[str, Any]) -> str:
    """Адрес контракта токена. watcher его не шлёт — берём из спеки paymod."""
    explicit = deposit.get("token_address") or deposit.get("token")
    if isinstance(explicit, str) and explicit.startswith("0x"):
        return explicit
    network = str(deposit.get("network") or "")
    symbol = str(deposit.get("symbol") or "")
    try:
        spec = _ensure_paymod().networks.token_spec(network, symbol)
        if spec:
            return str(spec["contract"])
    except Exception as exc:  # noqa: BLE001
        logger.debug("token contract unavailable (%s/%s): %s", network, symbol, exc)
    return ""


def _amount_raw(deposit: dict[str, Any], symbol: str) -> str:
    """Сумма в atomic единицах ТОКЕНА (18 для BSC/USDT).

    `amount_raw` приоритетнее — если watcher когда-нибудь начнёт его отдавать
    (raw-единицы контракта), конвертация не нужна. Иначе берём `amount_atomic`
    и разворачиваем 6 -> token_decimals.
    """
    raw = deposit.get("amount_raw")
    if raw not in (None, ""):
        return str(raw)
    network = str(deposit.get("network") or "")
    return to_chain_raw(deposit.get("amount_atomic"), token_decimals(network, symbol))


async def _on_deposit(deposit: dict[str, Any]) -> None:
    """Колбэк paymod.run_watcher: конвертирует депозит в webhook-событие deposit.

    Контракт-мост между watcher'ом и бэкендом. watcher отдаёт человекочитаемую
    `amount` и нормализованную к 6 decimals `amount_atomic`; бэкенд ждёт
    `amount_raw` в decimals токена — пересчёт здесь (H1).
    """
    client_ref = deposit.get("client_ref") or deposit.get("wallet_id") or ""
    symbol = str(deposit.get("symbol") or deposit.get("token") or "")
    payload = {
        "event": "deposit",
        "client_ref": client_ref,
        "chain": _chain_name(deposit),
        "token": symbol,
        "token_address": _token_address(deposit),
        "tx_hash": deposit.get("tx_hash", ""),
        "from": deposit.get("from", ""),
        "to": deposit.get("to", ""),
        "amount": deposit.get("amount", ""),
        "amount_raw": _amount_raw(deposit, symbol),
        "is_new": deposit.get("is_new"),
        "block_number": deposit.get("block_number"),
    }
    logger.info(
        "deposit detected: ref=%s tx=%s amount_raw=%s",
        client_ref,
        payload["tx_hash"],
        payload["amount_raw"],
    )
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