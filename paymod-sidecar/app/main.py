"""Paymod sidecar — FastAPI-приложение.

Слушает 127.0.0.1:8100 (из systemd/uvicorn). Владеет paymod (HD-деривация,
watcher, sweeper, выплаты из казны) и отдаёт NestJS минимальный HMAC-защищённый
REST: health, address (derive), payout, tx/{hash}.

Маршруты (ТЗ раздел 4.2):
  GET  /v1/health          — liveliness (без подписи)
  POST /v1/address         — {client_ref, chain, token} -> {address} (идемпотентно)
  POST /v1/payout          — {idempotency_key, to_address, amount, token, chain} -> {tx_hash, status}
  GET  /v1/tx/{tx_hash}    — статус свипа/выплаты (заглушка-прокси к paymod.db)
"""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from .auth import HmacAuthMiddleware
from .background import start_background_tasks
from .db import SidecarDB
from .paymod_client import derive_address, pay_erc20

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("paymod-sidecar")

db = SidecarDB()


class AddressRequest(BaseModel):
    client_ref: str
    chain: str
    token: str


class PayoutRequest(BaseModel):
    idempotency_key: str
    client_ref: Optional[str] = None
    to_address: str
    amount: str
    token: str
    chain: str


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect()
    # Запускаем watcher + sweeper только если включено (по умолчанию — да).
    if os.environ.get("PAYMOD_BACKGROUND", "1") not in ("0", "false", "no"):
        await start_background_tasks()
    yield
    await db.close()


app = FastAPI(title="paymod sidecar", version="1.0.0", lifespan=lifespan)
app.add_middleware(HmacAuthMiddleware)


@app.get("/v1/health")
async def health() -> dict:
    return {"status": "ok"}


@app.post("/v1/address")
async def get_address(req: AddressRequest) -> dict:
    """Дерive детерминированный адрес для client_ref (идемпотентно)."""
    existing = await db.get_wallet(req.client_ref)
    if existing is not None:
        return {"address": existing["address"]}

    index = await db.next_index(req.chain)
    try:
        address = derive_address(req.client_ref, req.chain, index)
    except Exception as exc:  # noqa: BLE001
        logger.exception("address derivation failed for %s", req.client_ref)
        raise HTTPException(status_code=500, detail=f"derivation failed: {exc}") from exc

    await db.save_wallet(req.client_ref, req.chain, req.token, index, address)
    return {"address": address}


@app.post("/v1/payout")
async def create_payout(req: PayoutRequest) -> dict:
    """Выполняет выплату из казны. Идемпотентно по idempotency_key."""
    existing = await db.get_payout(req.idempotency_key)
    if existing is not None:
        return {
            "tx_hash": existing["tx_hash"],
            "status": existing["status"],
            "error": existing["error"],
            "replayed": True,
        }

    await db.save_payout(
        req.idempotency_key,
        req.to_address,
        req.amount,
        req.token,
        req.chain,
        req.client_ref,
    )

    try:
        amount_raw = int(req.amount)
    except ValueError as exc:
        await db.update_payout(req.idempotency_key, status="failed", error="invalid amount")
        raise HTTPException(status_code=400, detail="amount must be an integer raw value") from exc

    # chain: bsc/base/arbitrum -> paymod network: BSC/Base/Arbitrum
    network = {"bsc": "BSC", "base": "Base", "arbitrum": "Arbitrum"}.get(
        req.chain.lower(), req.chain
    )
    try:
        tx_hash, ok = await pay_erc20(network, req.token, req.to_address, amount_raw)
    except Exception as exc:  # noqa: BLE001
        logger.exception("payout failed for %s", req.idempotency_key)
        await db.update_payout(req.idempotency_key, status="failed", error=str(exc))
        raise HTTPException(status_code=500, detail=f"payout failed: {exc}") from exc

    if ok:
        await db.update_payout(req.idempotency_key, status="submitted", tx_hash=tx_hash)
        return {"tx_hash": tx_hash, "status": "submitted"}
    await db.update_payout(req.idempotency_key, status="failed", error="insufficient balance or gas")
    return {"tx_hash": None, "status": "failed", "error": "insufficient balance or gas"}


@app.get("/v1/tx/{tx_hash}")
async def get_tx_status(tx_hash: str) -> dict:
    """Статус свипа/выплаты. Заглушка — прокидываем из paymod.db при наличии."""
    # paymod сам хранит sweeps в своей БД; здесь отдаём контрактно-стабильный ответ.
    # Реальный статус подтверждений доступен через paymod.chain/watcher при доработке.
    return {"tx_hash": tx_hash, "status": "unknown", "confirmations": 0}