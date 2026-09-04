# Paymod Sidecar — крипто-платёжный бэкенд для marketplace-pwa

Тонкий Python-процесс (FastAPI + uvicorn, asyncio), который владеет отлаженным
модулем `paymod` (HD-деривация депозит-адресов, watcher ERC-20 на BSC/Base/Arbitrum
через Ankr, sweeper на `MAIN_WALLET_ADDRESS`, выплаты USDT BSC из казны) и отдаёт
NestJS-бэкенду минимальный REST-контракт по `127.0.0.1:8100` с HMAC-подписью.

Секреты (seed/privkey) живут ТОЛЬКО здесь, в `.env` (chmod 600, user `paymod`).
NestJS получает лишь адреса/статусы/хэши транзакций.

## Структура

```
paymod-sidecar/
├── app/
│   ├── __init__.py
│   ├── main.py          # FastAPI + маршруты /v1/health, /v1/address, /v1/payout, /v1/tx/{hash}
│   ├── auth.py          # HMAC middleware + sign/verify (base64 HMAC-SHA256, окно 60с)
│   ├── db.py            # SQLite (aiosqlite): derived_wallets, payouts
│   ├── background.py    # asyncio-таски run_watcher + run_sweeper → webhook в NestJS
│   └── paymod_client.py # ленивый импорт paymod, derive_address, pay_erc20
├── requirements.txt
├── paymod.service       # systemd-юнит
├── .env.example
└── README.md
```

## API (ТЗ раздел 4.2)

Все запросы (кроме health) подписаны HMAC. Подпись:

```
signature = base64( HMAC-SHA256( secret, timestamp + "." + raw_body ) )
```

Заголовки: `X-Paymod-Timestamp` (unix-сек), `X-Paymod-Signature`.

| Endpoint | Тело | Ответ |
|---|---|---|
| `GET /v1/health` | — | `{status:"ok"}` |
| `POST /v1/address` | `{client_ref, chain, token}` | `{address}` |
| `POST /v1/payout` | `{idempotency_key, client_ref, to_address, amount, token, chain}` | `{tx_hash, status}` |
| `GET /v1/tx/{tx_hash}` | — | `{tx_hash, status, confirmations}` |

- `/v1/address` детерминированно привязывает `client_ref` → индекс → адрес, повторный
  запрос с тем же `client_ref` возвращает тот же адрес (идемпотентно).
- `/v1/payout` уникален по `idempotency_key`; повторный запрос возвращает результат
  первой попытки (не дублирует выплату).
- `amount` в payout — **сырые атомарные единицы токена** (18 decimals для USDT BSC),
  не доллары.

## Webhook в NestJS (исходящий)

`POST {PAYMOD_WEBHOOK_URL}` с теми же HMAC-заголовками. События:

- `deposit` — зачисление на депозит-адрес (поля: client_ref, chain, token,
  token_address, tx_hash, from, to, amount, amount_raw, block_number).
- `sweep.confirmed` — информативное событие свипа.

## Деплой на ForkerX

Каталоги на 89.167.0.215 уже подготовлены:

- `/opt/marketplace/paymod/paymod/` — модуль paymod (chain.py, db.py, watcher.py, ...)
- `/opt/marketplace/paymod/.env` — заполнен реальными секретами (chmod 600)

1. Скопировать `app/` в `/opt/marketplace/paymod/app/`, `requirements.txt` туда же.
2. Проверить, что в `/opt/marketplace/paymod/.env` есть:
   - `DISTRIBUTOR_SEED`, `DISTRIBUTOR_PRIVKEY`, `MAIN_WALLET_ADDRESS`,
     `USER_WALLET_DERIVATION_PATH`, `ANKR_RPC_KEY`
   - `DB_PATH=/opt/marketplace/paymod/paymod.db`, `DB_ALLOW_CREATE=1`, `MIN_DEPOSIT_USD`
   - `PAYMOD_SHARED_SECRET` (совпадает с NestJS `PAYMOD_SHARED_SECRET`)
3. Виртуальное окружение:

   ```bash
   cd /opt/marketplace/paymod
   python3 -m venv .venv
   .venv/bin/pip install -r requirements.txt
   ```

4. systemd-юнит:

   ```bash
   sudo useradd --system --home /opt/marketplace/paymod --shell /usr/sbin/nologin paymod
   sudo chown -R paymod:paymod /opt/marketplace/paymod
   sudo cp paymod.service /etc/systemd/system/paymod.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now paymod
   systemctl status paymod
   ```

5. Проверка:

   ```bash
   # живость (без подписи)
   curl http://127.0.0.1:8100/v1/health

   # подписанный запрос (пример генерации подписи)
   # python3 - <<'PY'
   # import hmac, hashlib, base64, time, json
   # secret = "..."  # PAYMOD_SHARED_SECRET
   # body = json.dumps({"client_ref":"mp-txn-1","chain":"bsc","token":"USDT"}).encode()
   # ts = str(int(time.time()))
   # sig = base64.b64encode(hmac.new(secret.encode(), f"{ts}.{body.decode()}".encode(), hashlib.sha256).digest()).decode()
   # print(f'curl -H "X-Paymod-Timestamp: {ts}" -H "X-Paymod-Signature: {sig}" -H "Content-Type: application/json" -d \'{body.decode()}\' http://127.0.0.1:8100/v1/address')
   # PY
   ```

## Безопасность

- Sidecar слушает только `127.0.0.1:8100` — публичной привязки нет.
- HMAC-SHA256 + timestamp-окно 60 с против replay.
- Секреты только в `.env` (600, user paymod), никогда не в NestJS `.env`, не в git,
  не в логах. `.env` в `.gitignore`.
- Идемпотентность: депозит по `tx_hash` (unique в SQLite/Postgres), выплата по
  `idempotency_key` (unique).