"""J3 — сверка адреса получателя: sidecar САМ достаёт выданный адрес.

Проблема: вендоренный `paymod.watcher._handle_log` (общий с agentbox, править
нельзя) в callback поля `to` НЕ передаёт. Значит `_on_deposit` отправлял
`"to": ""`, и на бэкенде проверка

    transaction.depositAddress && to && to !== depositAddress

короткозамыкалась на пустом `to` → **сверка адреса получателя была мертва**.

Решение: sidecar — тот, кто ВЫДАЛ адрес (`create_deposit_wallet(client_ref)`),
значит он может достать его сам по `client_ref` из `paymod.db.wallet_directory()`
и положить в payload. Эти тесты проверяют ровно это.

Тесты НЕ требуют paymod: `lookup_wallet_address` подменяется (в CI PAYMOD_DIR
может отсутствовать). Отдельный тест против реального paymod.db — помечен
skip'ом, если PAYMOD_DIR не задан.
"""
from __future__ import annotations

import asyncio
import os
from typing import Any

import pytest

from app import background
from app import paymod_client


def watcher_deposit(**over: Any) -> dict[str, Any]:
    """Ровно тот словарь, который кладёт `paymod.watcher._handle_log`.

    Обратите внимание: ключа `to` здесь НЕТ — это и есть баг J3.
    """
    deposit: dict[str, Any] = {
        "wallet_id": 1,
        "client_ref": "mp-txn-order-1",
        "network": "BSC",
        "symbol": "USDT",
        "amount": 1.0,
        "amount_atomic": 1_000_000,
        "tx_hash": "0x" + "ab" * 32,
        "is_new": True,
    }
    deposit.update(over)
    return deposit


@pytest.fixture()
def captured(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    sent: list[dict[str, Any]] = []

    async def fake_post(payload: dict[str, Any]) -> None:
        sent.append(payload)

    monkeypatch.setattr(background, "_post_webhook", fake_post)
    return sent


def patch_lookup(
    monkeypatch: pytest.MonkeyPatch,
    *,
    address: str | None = None,
    raises: Exception | None = None,
    record: list[str] | None = None,
):
    """Подменяет `lookup_wallet_address` в namespace background."""

    async def fake(client_ref: str):
        if record is not None:
            record.append(client_ref)
        if raises is not None:
            raise raises
        return address

    monkeypatch.setattr(background, "lookup_wallet_address", fake)


async def payload_of(deposit: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    sent: list[dict[str, Any]] = []

    async def fake_post(payload: dict[str, Any]) -> None:
        sent.append(payload)

    monkeypatch.setattr(background, "_post_webhook", fake_post)
    await background._on_deposit(deposit)
    assert len(sent) == 1
    return sent[0]


# ── 1. ГЛАВНОЕ: пустой `to` у watcher'а → адрес достаётся сам ───────────────


def test_to_filled_from_wallet_directory(monkeypatch: pytest.MonkeyPatch) -> None:
    """Регресс J3: watcher `to` не шлёт — sidecar подставляет выданный адрес."""
    patch_lookup(monkeypatch, address="0xIssuedDepositAddress")
    payload = asyncio.run(payload_of(watcher_deposit(), monkeypatch))
    assert payload["to"] == "0xIssuedDepositAddress", (
        "to пустой — сверка адреса получателя на бэкенде снова мертва"
    )


def test_lookup_called_with_client_ref(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[str] = []
    patch_lookup(monkeypatch, address="0xAddr", record=seen)
    asyncio.run(payload_of(watcher_deposit(), monkeypatch))
    assert seen == ["mp-txn-order-1"]


def test_explicit_to_wins_and_lookup_not_called(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Если watcher когда-нибудь начнёт отдавать `to` — он приоритетнее."""
    seen: list[str] = []
    patch_lookup(monkeypatch, address="0xFromDirectory", record=seen)
    payload = asyncio.run(
        payload_of(watcher_deposit(to="0xFromWatcher"), monkeypatch)
    )
    assert payload["to"] == "0xFromWatcher"
    assert seen == [], "лукап не должен вызываться, когда watcher дал to"


# ── 2. Обратная совместимость: адрес не достали — депозит НЕ теряется ──────


def test_address_not_found_keeps_to_empty_and_delivers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Нет записи по client_ref → `to` пустой, но webhook всё равно уходит."""
    patch_lookup(monkeypatch, address=None)
    payload = asyncio.run(payload_of(watcher_deposit(), monkeypatch))
    assert payload["to"] == ""
    # Депозит не потерян: сумма и хэш на месте, событие уходит.
    assert payload["amount_raw"] == "1000000000000000000"
    assert payload["tx_hash"] == "0x" + "ab" * 32


def test_lookup_crash_does_not_lose_deposit(monkeypatch: pytest.MonkeyPatch) -> None:
    """Падение лукапа НЕ должно терять депозит (деньги важнее сверки)."""
    patch_lookup(monkeypatch, raises=RuntimeError("paymod.db не инициализирован"))
    payload = asyncio.run(payload_of(watcher_deposit(), monkeypatch))
    assert payload["to"] == ""
    assert payload["amount_raw"] == "1000000000000000000"
    assert payload["chain"] == "bsc"


def test_empty_client_ref_skips_lookup(monkeypatch: pytest.MonkeyPatch) -> None:
    """Нет client_ref — лукапить нечего, но и падать незачем."""
    seen: list[str] = []
    patch_lookup(monkeypatch, address="0xAddr", record=seen)
    deposit = watcher_deposit()
    deposit.pop("client_ref")
    deposit.pop("wallet_id")
    payload = asyncio.run(payload_of(deposit, monkeypatch))
    assert seen == []
    assert payload["to"] == ""


# ── 3. lookup_wallet_address: только чтение, без выдачи новых адресов ──────


def test_lookup_reads_directory_and_never_creates(monkeypatch: pytest.MonkeyPatch) -> None:
    """Лукап обязан быть read-only: никакого `create_deposit_wallet`.

    Иначе на каждый незнакомый client_ref плодился бы новый кошелёк.
    """
    calls: list[str] = []

    class FakeDB:
        async def wallet_directory(self):
            return [
                {"client_ref": "other", "address": "0xOther"},
                {"client_ref": "mp-txn-order-1", "address": "0xIssued"},
            ]

        async def create_deposit_wallet(self, *a, **kw):  # pragma: no cover
            calls.append("create")
            raise AssertionError("lookup не должен выдавать новые адреса")

    class FakePaymod:
        db = FakeDB()

    monkeypatch.setattr(paymod_client, "_ensure_paymod", lambda: FakePaymod)

    got = asyncio.run(paymod_client.lookup_wallet_address("mp-txn-order-1"))
    assert got == "0xIssued"
    assert calls == []


def test_lookup_returns_none_for_unknown_ref(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeDB:
        async def wallet_directory(self):
            return [{"client_ref": "other", "address": "0xOther"}]

    class FakePaymod:
        db = FakeDB()

    monkeypatch.setattr(paymod_client, "_ensure_paymod", lambda: FakePaymod)
    assert asyncio.run(paymod_client.lookup_wallet_address("nope")) is None


def test_lookup_tolerates_missing_address(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeDB:
        async def wallet_directory(self):
            return [{"client_ref": "ref", "address": None}]

    class FakePaymod:
        db = FakeDB()

    monkeypatch.setattr(paymod_client, "_ensure_paymod", lambda: FakePaymod)
    assert asyncio.run(paymod_client.lookup_wallet_address("ref")) is None


# ── 4. Против РЕАЛЬНОГО paymod.db (если PAYMOD_DIR доступен) ───────────────


def test_lookup_against_real_paymod_db() -> None:
    """Живая проверка: берём реальный client_ref из paymod.db и находим адрес.

    Это НЕ мок: `lookup_wallet_address` реально читает боевую paymod.db через
    вендоренный `paymod.db.wallet_directory()`. Доказывает, что сайдкар
    способен достать выданный адрес на живых данных.
    """
    if not os.environ.get("PAYMOD_DIR"):
        pytest.skip("PAYMOD_DIR не задан — живой paymod недоступен")

    import sqlite3

    db_path = os.environ.get("DB_PATH", "")
    if not db_path or not os.path.exists(db_path):
        pytest.skip(f"paymod.db недоступна: {db_path!r}")

    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    row = con.execute(
        "SELECT client_ref, address FROM wallets ORDER BY id DESC LIMIT 1"
    ).fetchone()
    con.close()
    if row is None:
        pytest.skip("в paymod.db нет ни одного кошелька")

    # paymod.db требует явной инициализации соединения (как в lifespan sidecar).
    import paymod.db as paymod_db

    async def run_lookup() -> str | None:
        await paymod_db.init_db()
        try:
            return await paymod_client.lookup_wallet_address(row["client_ref"])
        finally:
            await paymod_db.close_db()

    got = asyncio.run(run_lookup())
    assert got == row["address"], (
        f"лукап вернул {got!r}, а в paymod.db {row['address']!r}"
    )