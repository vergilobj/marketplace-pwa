"""H1 — маппинг депозита watcher -> webhook sidecar.

Ловит ОБА расхождения, из-за которых реальный депозит никогда не подтверждался:

1. ИМЯ ПОЛЯ. `paymod.watcher._handle_log` отдаёт в callback `amount_atomic`,
   а не `amount_raw`. Старый `background.py` читал `deposit["amount_raw"]`,
   получал `""` и бэкенд отвечал `unverifiable_amount_raw` (Transaction
   навсегда PENDING).

2. ТОЧНОСТЬ. `amount_atomic` — человекочитаемая сумма, нормализованная
   watcher'ом к 6 decimals (`int(round(amount * 1_000_000))`), а бэкенд хранит
   `expectedAmountRaw` в decimals САМОГО токена (BSC/USDT = 18). Без пересчёта
   6 -> 18 сумма уезжает в UNDERPAID в 10^12 раз.

Плюс проверяем, что `chain` больше не пустой (иначе сверка сети/адреса на
бэкенде короткозамыкается и мертва).
"""
from __future__ import annotations

import asyncio
import pathlib
import re
from typing import Any

import pytest

from app import background

# ── фикстуры ────────────────────────────────────────────────────────────────


def watcher_deposit(**over: Any) -> dict[str, Any]:
    """Ровно тот словарь, который кладёт `paymod.watcher._handle_log`."""
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
    """Перехватывает webhook, который `_on_deposit` реально отправляет."""
    sent: list[dict[str, Any]] = []

    async def fake_post(payload: dict[str, Any]) -> None:
        sent.append(payload)

    monkeypatch.setattr(background, "_post_webhook", fake_post)
    return sent


async def payload_of(deposit: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    sent: list[dict[str, Any]] = []

    async def fake_post(payload: dict[str, Any]) -> None:
        sent.append(payload)

    monkeypatch.setattr(background, "_post_webhook", fake_post)
    await background._on_deposit(deposit)
    assert len(sent) == 1
    return sent[0]


# ── 1. имя поля ─────────────────────────────────────────────────────────────


def test_amount_atomic_is_consumed(monkeypatch: pytest.MonkeyPatch) -> None:
    """Регресс на баг: `amount_raw` в deposit'е watcher'а НЕТ.

    Если снова начать читать только `deposit["amount_raw"]`, payload получит
    пустую строку и бэкенд уйдёт в `unverifiable_amount_raw`.
    """
    payload = asyncio.run(payload_of(watcher_deposit(), monkeypatch))
    assert payload["amount_raw"] != "", "amount_raw пустой — бэкенд не подтвердит депозит"
    assert payload["amount_raw"].isdigit()


def test_payload_matches_backend_contract(monkeypatch: pytest.MonkeyPatch) -> None:
    """Полный контракт webhook'а: все поля, которые читает handler."""
    payload = asyncio.run(payload_of(watcher_deposit(), monkeypatch))

    assert payload["event"] == "deposit"
    assert payload["client_ref"] == "mp-txn-order-1"
    assert payload["tx_hash"] == "0x" + "ab" * 32
    assert payload["token"] == "USDT"
    assert payload["chain"] == "bsc", "chain пустой → сверка сети на бэкенде мертва"
    assert payload["amount_raw"] == "1000000000000000000"


# ── 2. точность 6 -> 18 ─────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("amount_atomic", "expected_raw"),
    [
        (1_000_000, 10**18),          # 1 USDT
        (5_000_000, 5 * 10**18),      # 5 USDT
        (12_340_000, 12_340_000 * 10**12),  # 12.34 USDT
        (1, 10**12),                  # минимальная различимая единица
    ],
)
def test_6_decimals_scaled_to_18(
    amount_atomic: int, expected_raw: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    """BSC/USDT: бэкенд ждёт raw в 18 decimals (`toRaw(x, 18)`)."""
    payload = asyncio.run(
        payload_of(watcher_deposit(amount_atomic=amount_atomic), monkeypatch)
    )
    assert payload["amount_raw"] == str(expected_raw)


def test_underpaid_regression_amount_not_10_pow_12_short(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Старое поведение дало бы 1_000_000 вместо 10**18 → UNDERPAID."""
    payload = asyncio.run(payload_of(watcher_deposit(amount_atomic=1_000_000), monkeypatch))
    got = int(payload["amount_raw"])
    assert got == 10**18
    assert got != 1_000_000, "сумма не пересчитана в decimals токена — UNDERPAID"
    assert got / 10**12 == 1_000_000


def test_six_decimal_token_not_scaled(monkeypatch: pytest.MonkeyPatch) -> None:
    """Base/USDC (6 decimals) — пересчёт не нужен, масштаб не трогаем."""
    payload = asyncio.run(
        payload_of(
            watcher_deposit(network="Base", symbol="USDC", amount_atomic=1_000_000),
            monkeypatch,
        )
    )
    assert payload["amount_raw"] == "1000000"
    assert payload["chain"] == "base"


def test_amount_raw_passthrough_wins(monkeypatch: pytest.MonkeyPatch) -> None:
    """Если watcher когда-нибудь отдаст настоящий raw — не трогаем его."""
    payload = asyncio.run(
        payload_of(
            watcher_deposit(amount_raw="1234567890123456789", amount_atomic=1_000_000),
            monkeypatch,
        )
    )
    assert payload["amount_raw"] == "1234567890123456789"


def test_missing_amount_atomic_is_empty_not_garbage(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = asyncio.run(
        payload_of(watcher_deposit(amount_atomic=None), monkeypatch)
    )
    assert payload["amount_raw"] == ""


# ── 3. chain / token ────────────────────────────────────────────────────────


def test_chain_id_mapped_to_backend_name(monkeypatch: pytest.MonkeyPatch) -> None:
    """chain_id paymod (56) -> 'bsc', как пишет `payments.service.ts`."""
    payload = asyncio.run(payload_of(watcher_deposit(chain_id=56), monkeypatch))
    assert payload["chain"] == "bsc"


def test_chain_from_network_when_no_chain_id(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = asyncio.run(payload_of(watcher_deposit(network="Arbitrum"), monkeypatch))
    assert payload["chain"] == "arbitrum"


def test_token_address_filled_from_spec(monkeypatch: pytest.MonkeyPatch) -> None:
    """watcher не шлёт token_address — берём контракт из спеки paymod."""
    payload = asyncio.run(payload_of(watcher_deposit(), monkeypatch))
    assert payload["token_address"] == "0x55d398326f99059ff775485246999027b3197955"


# ── 4. дрейф спеки: фолбэк обязан совпадать с вендоренным paymod ────────────


def test_fallback_decimals_mirror_vendor_spec() -> None:
    """`_FALLBACK_TOKEN_DECIMALS` — зеркало `paymod/networks.py:TOKENS`.

    Читаем файл вендоренного модуля как текст: импортировать его нельзя
    (`paymod.config` требует свой .env, которого у маркетплейса нет).
    """
    vendor = pathlib.Path("/Users/vergilobj/agentbox/paymod/paymod/networks.py")
    if not vendor.exists():
        pytest.skip("вендоренный paymod недоступен")

    text = vendor.read_text(encoding="utf-8")
    pattern = re.compile(
        r'\{"network":\s*"(?P<net>\w+)",\s*"symbol":\s*"(?P<sym>\w+)",\s*'
        r'"contract":\s*"(?P<contract>0x[0-9a-fA-F]+)",\s*"decimals":\s*(?P<dec>\d+)\}'
    )
    found = pattern.findall(text)
    assert found, "не распарсили TOKENS из вендоренного networks.py"

    for net, sym, _contract, dec in found:
        key = (net.upper(), sym.upper())
        if key in background._FALLBACK_TOKEN_DECIMALS:
            assert background._FALLBACK_TOKEN_DECIMALS[key] == int(dec), (
                f"{key}: фолбэк {background._FALLBACK_TOKEN_DECIMALS[key]} != "
                f"спека paymod {dec}"
            )

    bsc_usdt = [t for t in found if t[0] == "BSC" and t[1] == "USDT"]
    assert bsc_usdt, "BSC/USDT пропал из спеки paymod"
    assert int(bsc_usdt[0][3]) == 18, "BSC/USDT decimals изменился — множитель 10^12 неверен"


def test_scaling_factor_is_10_pow_12_for_bsc_usdt() -> None:
    """Обоснование множителя: decimals(BSC/USDT)=18, watcher нормализует к 6."""
    assert background.WATCHER_ATOMIC_DECIMALS == 6
    assert background.to_chain_raw(1_000_000, 18) == str(10**18)
    assert background.to_chain_raw(1_000_000, 6) == "1000000"


def test_to_chain_raw_never_returns_negative_or_junk() -> None:
    assert background.to_chain_raw("", 18) == ""
    assert background.to_chain_raw(None, 18) == ""
    assert background.to_chain_raw("abc", 18) == ""
    assert background.to_chain_raw(-1, 18) == ""