"""SQLite-слой sidecar (aiosqlite).

Ведёт крипто-операционную правду (derived_wallets, payouts) отдельно от
paymod.db (которую ведёт сам paymod: wallets, deposits, sweeps, scan_cursors).
"""
from __future__ import annotations

import os
import time
from typing import Any, Optional

import aiosqlite

SIDECAR_DB_DEFAULT = os.path.join(os.path.dirname(__file__), "..", "sidecar.db")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS derived_wallets (
    client_ref     TEXT PRIMARY KEY,
    chain          TEXT NOT NULL,
    token          TEXT NOT NULL,
    address_index  INTEGER NOT NULL,
    address        TEXT NOT NULL,
    created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payouts (
    idempotency_key TEXT PRIMARY KEY,
    client_ref      TEXT,
    to_address      TEXT NOT NULL,
    amount          TEXT NOT NULL,
    token           TEXT NOT NULL,
    chain           TEXT NOT NULL,
    tx_hash         TEXT,
    status          TEXT NOT NULL,
    error           TEXT,
    created_at      INTEGER NOT NULL
);
"""


class SidecarDB:
    """Тонкая обёртка над aiosqlite для sidecar-таблиц."""

    def __init__(self, path: str | None = None):
        self.path = path or os.environ.get("SIDECAR_DB_PATH", SIDECAR_DB_DEFAULT)
        self._conn: Optional[aiosqlite.Connection] = None

    async def connect(self) -> None:
        self._conn = await aiosqlite.connect(self.path)
        self._conn.row_factory = aiosqlite.Row
        await self._conn.executescript(_SCHEMA)
        await self._conn.commit()

    async def close(self) -> None:
        if self._conn is not None:
            await self._conn.close()
            self._conn = None

    @property
    def conn(self) -> aiosqlite.Connection:
        if self._conn is None:
            raise RuntimeError("SidecarDB not connected")
        return self._conn

    async def get_wallet(self, client_ref: str) -> Optional[dict[str, Any]]:
        cur = await self.conn.execute(
            "SELECT * FROM derived_wallets WHERE client_ref = ?",
            (client_ref,),
        )
        row = await cur.fetchone()
        return dict(row) if row else None

    async def save_wallet(
        self,
        client_ref: str,
        chain: str,
        token: str,
        address_index: int,
        address: str,
    ) -> None:
        await self.conn.execute(
            """
            INSERT OR IGNORE INTO derived_wallets
                (client_ref, chain, token, address_index, address, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (client_ref, chain, token, address_index, address, int(time.time())),
        )
        await self.conn.commit()

    async def next_index(self, chain: str) -> int:
        """Монотонный индекс HD-деривации: MAX(address_index)+1 для этой сети."""
        cur = await self.conn.execute(
            "SELECT COALESCE(MAX(address_index), -1) AS m FROM derived_wallets WHERE chain = ?",
            (chain,),
        )
        row = await cur.fetchone()
        return int(row["m"]) + 1

    async def get_payout(self, idempotency_key: str) -> Optional[dict[str, Any]]:
        cur = await self.conn.execute(
            "SELECT * FROM payouts WHERE idempotency_key = ?",
            (idempotency_key,),
        )
        row = await cur.fetchone()
        return dict(row) if row else None

    async def save_payout(
        self,
        idempotency_key: str,
        to_address: str,
        amount: str,
        token: str,
        chain: str,
        client_ref: str | None,
    ) -> None:
        await self.conn.execute(
            """
            INSERT OR IGNORE INTO payouts
                (idempotency_key, client_ref, to_address, amount, token, chain,
                 status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
            """,
            (idempotency_key, client_ref, to_address, amount, token, chain, int(time.time())),
        )
        await self.conn.commit()

    async def update_payout(
        self,
        idempotency_key: str,
        *,
        status: str,
        tx_hash: str | None = None,
        error: str | None = None,
    ) -> None:
        await self.conn.execute(
            """
            UPDATE payouts
            SET status = ?, tx_hash = COALESCE(?, tx_hash), error = ?
            WHERE idempotency_key = ?
            """,
            (status, tx_hash, error, idempotency_key),
        )
        await self.conn.commit()