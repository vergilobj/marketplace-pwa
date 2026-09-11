# Деплой marketplace-pwa

> Актуально на **2026-09-11**. Топология, денежный контур и paymod-сайдкар проверены
> живьём по SSH (`ss -lntp`, `systemctl`, `curl`, `psql`) на обоих серверах.
> Где проверки не было — явно помечено «**по документации, не проверял живьём**».
> Проект: `/Users/vergilobj/marketplace-pwa`. Локальная разработка — macOS.

---

## 1. Реальная топология: Hetzner (мастер) + REG.RU (край)

```
                     DNS: xn--80aabz0c.shop  →  91.229.9.83 (REG.RU)
                                  │
                        ┌─────────▼──────────┐
                        │  REG.RU 91.229.9.83 │  nginx :80/:443
                        │  cv7951359.novalocal│  bazar-backend :3000
                        │  (Docker ОТСУТСТВУЕТ)│  frontend/dist (статика)
                        └─────────┬──────────┘
                                  │  autossh-туннель  bazar-tunnel.service
                                  │  15432→5435  16379→6380  18100→8100
                                  │  13000→3000  18642→8642
                        ┌─────────▼──────────────┐
                        │ Hetzner 89.167.0.215    │  docker: marketplace-db  :5435
                        │ (hostname: ForkerX)     │  docker: marketplace-redis :6380
                        │  Docker ЕСТЬ            │  paymod.service (uvicorn) :8100
                        │                         │  bazar-node.service        :3000
                        └─────────────────────────┘
```

| Узел | IP | Роль | Что крутится |
|---|---|---|---|
| **Hetzner** | `89.167.0.215` (ForkerX) | **мастер данных** | Postgres `marketplace-db` (:5435→5432, docker), Redis `marketplace-redis` (:6380→6379, docker), **paymod sidecar** (systemd `paymod.service`, uvicorn 127.0.0.1:8100), `bazar-node.service` (NestJS :3000) |
| **REG.RU** | `91.229.9.83` (cv7951359.novalocal) | **край / фронт** | nginx (сайт `/etc/nginx/sites-available/bazar.shop`), `bazar-backend.service` (NestJS :3000), `frontend/dist`, `bazar-tunnel.service` |

- **DNS:** `xn--80aabz0c.shop` (базар.shop) → **91.229.9.83** (REG.RU). Латиница `bazar.shop` и
  «базар.shop» без punycode **не резолвятся** — всегда использовать punycode.
- **SSL:** Let's Encrypt, авто-renew (`certbot.timer` активен — проверено).
- **Доступ:** Hetzner — по SSH-ключу. REG.RU — **только пароль** (root), ключ не принят:
  `sshpass -p '<пароль>' ssh -o StrictHostKeyChecking=no root@91.229.9.83`.

### 1.1 Туннели (важно не перепутать направление)

`bazar-tunnel.service` живёт **на REG.RU** и форвардит локальные порты REG.RU → Hetzner:

```
autossh -M 0 -N \
  -L 127.0.0.1:15432:127.0.0.1:5435   # Postgres (мастер на Hetzner)
  -L 127.0.0.1:16379:127.0.0.1:6380   # Redis
  -L 127.0.0.1:18100:127.0.0.1:8100   # paymod sidecar
  -L 127.0.0.1:13000:127.0.0.1:3000   # Hetzner-бэкенд (гео-роутинг «мир»)
  -L 127.0.0.1:18642:127.0.0.1:8642   # Hermes API Server (нейро-слой «Базар»)
  root@89.167.0.215
```

⚠️ На Hetzner висит **мёртвый обратный туннель** `bazar-tunnel.service` (форвардит
Hetzner-порты на REGRU — направление перепутано, бесполезен). Рабочий туннель только
REGRU→Hetzner.

⚠️ **Следствие:** на REG.RU **нет** локального `:8100` и `:8642`. Прод-`.env` на REGRU
обязан указывать на порты туннеля: `18100` (paymod) и `18642` (Hermes). См. §4.

### 1.2 Гео-роутинг nginx (REG.RU)

`/etc/nginx/nginx.conf` (проверено):

```nginx
upstream backend_ru    { server 127.0.0.1:3000;  }  # локальный бэк REG.RU
upstream backend_world { server 127.0.0.1:13000; }  # Hetzner через туннель

map $geo_country $backend_upstream {
    default backend_world;
    RU      backend_ru;
}
```

`location /api/`, `/uploads/`, `/socket.io/` в `bazar.shop` идут на `http://$backend_upstream`.
Бэкенд NestJS, таким образом, **поднят дважды**: `bazar-backend` (REGRU :3000) и
`bazar-node` (Hetzner :3000). Оба читают **одну и ту же** БД на Hetzner.

### 1.3 Структура на серверах

```
/opt/marketplace/
├── backend/          NestJS, dist/src/main.js, .env, node_modules
├── frontend/dist/    собранная статика (отдаёт nginx)
├── paymod/           (Hetzner) модуль paymod + app/ + .venv + paymod.db + sidecar.db
├── paymod-sidecar/   (есть и на REGRU — исходники сайдкара; на REGRU НЕ запускается)
└── nginx.conf, docker-compose.yml, mirror-deploy.sh
```

- REGRU: **Docker отсутствует** (`which docker` → пусто). Postgres/Redis только через туннель.
- Hetzner: Docker есть; `docker-compose.yml` поднимает `marketplace-db` + `marketplace-redis`.

---

## 2. 🚨 КРИТИЧНЫЙ ПИТФОЛЛ: `prisma generate` обязателен после смены схемы

**Симптом:** билд зелёный, бэкенд стартует, но `GET /products` падает с
`PrismaClientValidationError` (клиент не знает новое поле, например `isAd`, `videoUrl`,
`availableBalance`). Уже ловили **2026-09-08 на обоих серверах**.

**Причина:** `npm run build` (`nest build`) собирает TypeScript, но **не обновляет
Prisma-клиент**. Схема в `schema.prisma` новая, а сгенерированный клиент в
`node_modules/.prisma` — старый.

**Правило (не нарушать):**

```bash
cd /opt/marketplace/backend
git pull origin main
npm ci                      # если менялся package-lock.json
npx prisma generate         # ← ОБЯЗАТЕЛЬНО после любой правки schema.prisma
npm run build               # nest build → dist/src/main.js
sudo systemctl restart bazar-backend    # (на Hetzner: bazar-node)
```

`git pull` + `npm run build` **БЕЗ** `prisma generate` — недостаточно.

### 2.1 `db push` vs `migrate deploy` — реальная практика проекта

Исторически деплой шёл через **`prisma db push`** (ад-хок правки схемы: `isAd`,
`videoUrl`, `Product.media` и т.п. накатывались именно так). Из-за этого таблица
`_prisma_migrations` в проде **отстаёт** от `schema.prisma`, хотя каталог
`prisma/migrations/` в репозитории есть.

**Проверено живьём 2026-09-11** на мастер-БД Hetzner:

```
_prisma_migrations: 13 записей, последняя = 20260520002809_add_avatar
Local migrations/:  14 миграций (13 исторических + 20260911090000_money_contour)
```

То есть **недостаёт ровно одной миграции** — `money_contour`. Baseline чистый,
дрейфа по 13 старым миграциям нет → для денежного контура корректна команда:

```bash
npx prisma migrate deploy     # применит ТОЛЬКО 20260911090000_money_contour
```

Для разовых правок схемы вне миграций по-прежнему используется:

```bash
npx prisma db push --accept-data-loss
```

⚠️ **На REG.RU каталога `backend/prisma/migrations/` НЕТ** (проверено: `ls` → no such file).
Значит `npx prisma migrate deploy` там **упадёт**. Варианты: (а) досыпать каталог
`rsync -avz backend/prisma/ root@91.229.9.83:/opt/marketplace/backend/prisma/`, либо
(б) накатить `db push` с Hetzner-ноды. Мастер-схему держать в одном месте — **Hetzner**.

### 2.2 Второй питфолл: схема и БД разъезжаются

`db push`/миграция меняет `schema.prisma` и Prisma-клиент, но колонки в БД может **не быть**.
Симптом: билд зелёный, `POST /products` (или `PATCH`) падает. Проверка:

```bash
psql "$DATABASE_URL" -tAc \
  "SELECT column_name FROM information_schema.columns WHERE table_name='Order';"
```

---

## 3. Денежный контур (эскроу + ledger)

### 3.1 Что построено (локально, коммит `935a0a3`)

| Компонент | Файл |
|---|---|
| `LedgerEntry` (append-only журнал) + `LedgerAccount` | `backend/src/payments/ledger.service.ts` |
| `EscrowService` (hold / release / refund) | `backend/src/payments/escrow.service.ts` |
| `computeFees`, `round2`, BigInt-арифметика | `backend/src/payments/money.util.ts` |
| `AdActivationHook` (реклама активируется только после оплаты) | `backend/src/payments/ad-activation.hook.ts` |
| Раздельные балансы: `availableBalance` (торговая выручка) ≠ `bonusBalance` (реферальные) | `backend/prisma/schema.prisma` |
| `Order.escrowAmount / escrowStatus / autoCompleteAt / cancelReason / cancelledAt / completedAt / dealId` | `backend/prisma/schema.prisma` |
| `GET /users/me/ledger` | `backend/src/users/users.controller.ts` |
| `POST /orders/:id/confirm` (BUYER → COMPLETED + релиз эскроу) | `backend/src/marketplace/orders.controller.ts` |
| `PATCH /orders/:id/force-status` (ADMIN, `reason` обязателен) | `backend/src/marketplace/orders.controller.ts` |
| Миграция `20260911090000_money_contour` (аддитивная) | `backend/prisma/migrations/` |

**Ключевые инварианты (не сломать при доработках):**

- `processSuccessfulPayment` = **только холд** эскроу. Релиз продавцу — при `COMPLETED`
  либо по таймауту (5 дней на отправку / 7 дней на подтверждение → `autoCompleteAt`).
- `Transaction` = **внешние** крипто-события. `LedgerEntry` = **внутренние** деньги. Не смешивать.
- `refKey` с номером попытки: `withdrawal_debit:${requestId}:${attempt}:AVAILABLE` —
  без `attempt` повторное списание **тихо пропускается** (`skipDuplicates`).
- В webhook холд выполняется **ДО** записи `Transaction.status = CONFIRMED` (иначе ретрай мёртв).
- `adminForceStatus` при `CANCELLED` из `HELD` идёт через `refundEscrow`, а не через смену ярлыка.
- Срок рекламы — через `Transaction.payload.adDays`; рекламный заказ определяется по
  `Order.post` (@unique), **не** по `sellerId == ADMIN`.

### 3.2 ⚠️ НЕ ЗАДЕПЛОЕНО НА ПРОД (проверено живьём 2026-09-11)

| Что | Локально | REG.RU | Hetzner |
|---|---|---|---|
| git HEAD | `935a0a3` (денежный контур) | `996b5d0` | `996b5d0` |
| `User.availableBalance` в БД | — | **ОТСУТСТВУЕТ** | **ОТСУТСТВУЕТ** |
| Таблицы `LedgerEntry` / `LedgerAccount` | — | **ОТСУТСТВУЮТ** (0) | **ОТСУТСТВУЮТ** (0) |
| `Order.escrow*`, `autoCompleteAt`, `cancelReason` | — | **ОТСУТСТВУЮТ** | **ОТСУТСТВУЮТ** |
| Миграция `money_contour` | применена | **не применена** | **не применена** |

**Живое следствие:** на REG.RU шедулер каждую минуту падает —

```
ERROR [Scheduler] PrismaClientKnownRequestError:
Invalid `this.prisma.order.updateMany()` invocation
  dist/src/marketplace/orders.service.js:146  →  cancelExpiredOrders()
```

Вероятная причина (по коду + состоянию БД): `cancelExpiredOrders` пишет `cancelReason`/
`cancelledAt`, которых в прод-БД нет. Лечится накатом `money_contour` (§2.1).

**Деплой денежного контура не сделан. Пока он не сделан, прод живёт на старой логике
оплаты (без эскроу и ledger).**

---

## 4. Переменные окружения

### 4.1 `backend/.env`

| Переменная | Дефолт в коде | Локально | Прод (проверено) | Примечание |
|---|---|---|---|---|
| `DATABASE_URL` | — | `…@localhost:5432/marketplace` | REGRU `…@127.0.0.1:15432/…`, Hetzner `…@localhost:5435/…` | у REGRU — через туннель |
| `REDIS_URL` | `redis://localhost:6379` | `redis://localhost:6379` | REGRU `127.0.0.1:16379`, Hetzner `localhost:6380` | Bull-очереди |
| `PORT` | 3000 | — | `3000` | |
| `CORS_ORIGIN` | `main.ts:22` | не задан | `https://xn--80aabz0c.shop` | в проде обязателен |
| `JWT_ACCESS_SECRET` | — | задан | задан | |
| `JWT_REFRESH_SECRET` | — | задан | задан | |
| **`PAYMOD_SIDECAR_URL`** | `http://127.0.0.1:8100` | **не задан** | **REGRU `http://127.0.0.1:18100`**, Hetzner `…:8100` | см. §5 |
| **`PAYMOD_SHARED_SECRET`** | — | задан | задан | HMAC; **должен совпадать** с `paymod/.env` |
| **`BAZAR_API_URL`** | `http://127.0.0.1:8642/v1` | `http://127.0.0.1:8642/v1` | REGRU `http://127.0.0.1:18642/v1` | нейро-слой, через туннель |
| **`BAZAR_API_KEY`** | `''` | задан | задан | ключ Hermes API Server |
| **`BAZAR_MODEL`** | `bazar` | `bazar` | `bazar` | профиль Hermes |
| **`UPLOAD_BASE_URL`** | `''` | `http://localhost:3000` ⚠️ | `https://xn--80aabz0c.shop` ✅ | **в проде обязан быть прод-домен**, иначе картинки `/uploads/...` ломаются |
| `ONESIGNAL_APP_ID` | — | пусто | `d1cb2724-f8e5-40c4-8dec-2db841c83cba` | на серверах **реальный**, не `test` |
| `ONESIGNAL_REST_API_KEY` | — | задан | задан | |
| `NOWPAYMENTS_API_KEY` | — | задан | задан | вторичный провайдер |
| `NOWPAYMENTS_IPN_SECRET` | — | задан | задан | |
| `NOWPAYMENTS_IPN_URL` | — | — | `https://xn--80aabz0c.shop/payments/ipn` | нужен только при `payment_provider=nowpayments` |
| `NOWPAYMENTS_SANDBOX` | `true` | — | — | только в `.env.example` |
| `COMETCHAT_APP_ID` / `_AUTH_KEY` / `_REST_API_KEY` / `_WEBHOOK_SECRET` / `_REGION` | — | заданы | заданы | чат |
| `VITE_COMETCHAT_*`, `VITE_ONESIGNAL_APP_ID` | — | заданы | **build-time** | инлайнятся Vite при сборке фронта |

**Дефолтный платёжный провайдер — `paymod`** (BSC USDT). NowPayments включается сменой
настройки `payment_provider` в БД (`settingsService.get('payment_provider') || 'paymod'`).

### 4.2 `paymod-sidecar/.env` (только Hetzner, `chmod 600`, `user paymod`)

| Переменная | Пример / значение | Примечание |
|---|---|---|
| `DISTRIBUTOR_SEED` / `DISTRIBUTOR_PRIVKEY` | — | секреты казны, в git не коммитить |
| `MAIN_WALLET_ADDRESS` | `0x311407e2d76F9608ece32d040104CBAA627eD0F7` | казна (проверено на Hetzner) |
| `USER_WALLET_DERIVATION_PATH` | `m/44'/60'/0'/0'/{index}'` | |
| `ANKR_RPC_KEY` | — | RPC BSC |
| `DB_PATH` | `/opt/marketplace/paymod/paymod.db` | реестр кошельков |
| `DB_ALLOW_CREATE` | `1` | |
| `MIN_DEPOSIT_USD` | `5` | |
| `PAYMOD_SHARED_SECRET` | — | **== `backend/.env:PAYMOD_SHARED_SECRET`** |
| `PAYMOD_DIR` | `/opt/marketplace/paymod` | путь к Python-модулю paymod |
| `PAYMOD_WEBHOOK_URL` | `http://127.0.0.1:3000/payments/paymod/webhook` | sidecar → NestJS |
| `PAYMOD_BACKGROUND` | `1` | watcher + sweeper |
| `SIDECAR_DB_PATH` | `/opt/marketplace/paymod/sidecar.db` | SQLite сайдкара |

Обмен: **HMAC-SHA256** + anti-replay 60 с. NestJS → сайдкар: `POST /v1/address`,
`/v1/payout`, `GET /v1/tx/{hash}`. Сайдкар → NestJS: `POST /payments/paymod/webhook`.

---

## 5. Paymod sidecar — ОБЯЗАТЕЛЕН для оплаты

Что это: FastAPI-приложение (`paymod-sidecar/app/`) поверх Python-модуля `paymod`
(chain/db/wallets), слушает **127.0.0.1:8100**. Отвечает за выдачу депозит-адресов
ERC-20 (BSC USDT), сканирование входящих транзакций и выплаты из казны.

**Без работающего сайдкара `POST /orders` падает (`ECONNREFUSED`) — оплата не работает
вообще.** NestJS ходит в него по `PAYMOD_SIDECAR_URL`.

### 5.1 Прод (Hetzner) — systemd, автозапуск

```bash
sudo systemctl status paymod          # active (running) — проверено живьём
sudo systemctl restart paymod
journalctl -u paymod -f
```

Юнит `paymod-sidecar/paymod.service`: `User=paymod`, `EnvironmentFile=/opt/marketplace/paymod/.env`,
`ExecStart=/opt/marketplace/paymod/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8100`,
`Restart=always`, `NoNewPrivileges=true`, `ProtectSystem=full`.

Установка с нуля:

```bash
sudo cp paymod-sidecar/paymod.service /etc/systemd/system/paymod.service
sudo systemctl daemon-reload && sudo systemctl enable --now paymod
curl http://127.0.0.1:8100/v1/health     # → 200
```

### 5.2 REG.RU — сайдкар НЕ запускается, ходим через туннель

Проверено: локального `:8100` на REG.RU **нет**, но `http://127.0.0.1:18100/v1/health`
(через `bazar-tunnel`) → **200**. Поэтому в `backend/.env` на REG.RU:

```
PAYMOD_SIDECAR_URL=http://127.0.0.1:18100
```

Если поставить `8100` — будет `ECONNREFUSED`. **Это самая частая ошибка при деплое на REG.RU.**

### 5.3 Локально (macOS)

```bash
bash paymod-sidecar/run-local.sh     # поднимает uvicorn на 127.0.0.1:8100 из venv
```

Скрипт сам грузит `paymod-sidecar/.env` и использует `paymod-sidecar/venv/bin/python`.
Локально `PAYMOD_SIDECAR_URL` можно не задавать — код дефолтится на `http://127.0.0.1:8100`.

### 5.4 Питфоллы сайдкара

1. **`init_db()` в lifespan обязателен** — до старта watcher/sweeper. Иначе они пишут
   «paymod.db не инициализирован».
2. **Депозит-адрес — ТОЛЬКО через `paymod.db.create_deposit_wallet(client_ref)`**
   (кладёт в `paymod.db.wallets`). Watcher сканирует `wallet_directory()` из paymod.db;
   если писать адрес в собственную sidecar-таблицу — депозиты **не детектятся**.
3. **`PAYMOD_SHARED_SECRET` должен совпадать** в `backend/.env` и `paymod/.env`, иначе
   webhook/HMAC молча отбивается (401).
4. Подмодули paymod (`chain`, `config`, `db`, `wallets`) импортировать **явно** —
   `__init__.py` экспортирует не всё.

---

## 6. Порядок деплоя

### 6.1 Первичная подготовка узла

```bash
# --- Hetzner: инфраструктура ---
curl -fsSL https://get.docker.com | bash
cd /opt/marketplace && docker compose up -d      # marketplace-db :5435, marketplace-redis :6380

# --- REG.RU: Docker НЕ ставить ---
apt install -y nginx certbot python3-certbot-nginx autossh
```

Код: `git clone <repo> /opt/marketplace` (либо `rsync` из §7).

### 6.2 Обновление кода (обычный цикл)

```bash
cd /opt/marketplace
git pull origin main

cd backend
npm ci                                   # если менялся package-lock.json
npx prisma generate                       # ← КРИТИЧНО, см. §2
npx prisma migrate deploy                 # если в prisma/migrations/ появились новые
                                          # (на REG.RU каталога нет — см. §2.1)
npm run build                             # nest build → dist/src/main.js

# Hetzner:
sudo systemctl restart bazar-node
# REG.RU:
sudo systemctl restart bazar-backend
```

Фронтенд собирается **локально** и заливается статикой:

```bash
cd frontend && npm ci && npm run build    # tsc -b && vite build
rsync -avz --delete dist/ root@91.229.9.83:/opt/marketplace/frontend/dist/
```

⚠️ `npm run start:prod` в `backend/package.json` = `node dist/main` — **неверно** для этой
раскладки. Реально сервис запускает `node dist/src/main.js` (`dist/` → `dist/src/main.js`,
вложенный путь из-за `nest build` с общими файлами). Использовать путь из юнита.

### 6.3 Деплой денежного контура (отдельная процедура, ещё не выполнен)

1. **Бэкап БД** (обязательно — миграция меняет `User`, `Order`, `Transaction`):
   ```bash
   ssh root@89.167.0.215 \
     "docker exec marketplace-db pg_dump -U market_user marketplace | gzip > /root/backup-$(date +%F).sql.gz"
   ```
2. `git pull` на **Hetzner** → `npm ci` → `npx prisma generate` →
   `npx prisma migrate deploy` → `npm run build` → `systemctl restart bazar-node`.
3. `git pull` на **REG.RU** → `npm ci` → `npx prisma generate` → `npm run build` →
   `systemctl restart bazar-backend`.
   Миграцию применять **с Hetzner** (мастер-БД), на REG.RU только клиент+build.
4. **Порядок обязателен:** сначала `generate` + миграция, только потом рестарт.
   Иначе `PrismaClientValidationError` на `/products` и падение шедулера (§2).
5. Прогнать чеклист §8.

---

## 7. Зеркалирование на новый домен

Скрипт `mirror-deploy.sh <ssh-target> <new-domain>` (из `/opt/marketplace`).

⚠️ **Известный дефект:** скрипт предполагает **Docker на целевом узле** (шаг 2:
`docker exec marketplace-db pg_dump …`). На узле без Docker (как REG.RU) шаг падает,
а цепочка `|| … && …` из-за приоритета операторов ведёт себя не так, как задумано.
Для docker-less узлов БД выгружать с Hetzner вручную.

Ручной порядок:

```bash
# 1. Код
rsync -avz --exclude node_modules --exclude dist --exclude uploads \
      /opt/marketplace/ user@new-server:/opt/marketplace/

# 2. БД (с Hetzner-мастера)
ssh root@89.167.0.215 "docker exec marketplace-db pg_dump -U market_user marketplace" > /tmp/backup.sql
psql -U market_user marketplace < /tmp/backup.sql     # на новом узле

# 3. Сборка
cd /opt/marketplace/backend && npm ci && npx prisma generate && npm run build
cd /opt/marketplace/frontend && npm ci && npm run build

# 4. Домен: A-запись → IP нового узла, CORS_ORIGIN/UPLOAD_BASE_URL = новый домен,
#    server_name в nginx, SSL:
certbot --nginx -d new-domain.ru -d www.new-domain.ru

# 5. OneSignal: добавить новый домен в Origins (dashboard).
# 6. Пуш/пост пользователям о смене адреса + инструкция переустановки PWA
#    (Safari/Chrome → «Поделиться» → «На экран "Домой"»).
```

---

## 8. Проверка после деплоя (чеклист)

```bash
# 1. Каталог — 200, НЕ 500 (проверено живьём 2026-09-11: оба узла 200)
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/products
curl -s -o /dev/null -w '%{http_code}\n' https://xn--80aabz0c.shop/api/products

# 2. Баланс под токеном — 4 поля:
#    availableBalance, bonusBalance, pendingEscrow, totalWithdrawable
curl -s -H "Authorization: Bearer <token>" \
     https://xn--80aabz0c.shop/api/users/me/balance

# 3. Ledger — 200
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer <token>" \
     https://xn--80aabz0c.shop/api/users/me/ledger

# 4. Картинки товаров
curl -s -o /dev/null -w '%{http_code}\n' https://xn--80aabz0c.shop/uploads/picsum/<file>.jpg

# 5. Создание заказа — 201 + depositAddress
curl -s -X POST -H "Authorization: Bearer <token>" -H 'Content-Type: application/json' \
     -d '{"productId":"<id>","deliveryAddress":"<addr>"}' \
     https://xn--80aabz0c.shop/api/orders
```

Плюс:

```bash
# Сайдкар жив (Hetzner)
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8100/v1/health          # 200
# Сайдкар доступен с REG.RU (через туннель)
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18100/v1/health         # 200
# Туннель поднят
systemctl is-active bazar-tunnel
# Ошибки шедулера (не должно быть PrismaClientKnownRequestError)
journalctl -u bazar-backend --no-pager -n 100 | grep -i 'Scheduler'
# Колонки денежного контура доехали
ssh root@89.167.0.215 "docker exec marketplace-db psql -U market_user -d marketplace -tAc \
  \"SELECT column_name FROM information_schema.columns WHERE table_name='User' AND column_name='availableBalance';\""
```

---

## 9. Известные ограничения (честно)

1. **Денежный контур НЕ задеплоен** (§3.2). Локально `935a0a3`, на серверах `996b5d0`.
   В прод-БД нет `availableBalance`, `LedgerEntry`, `LedgerAccount`, `escrow*`, `cancelReason`.
   Миграция `20260911090000_money_contour` не применена. Шедулер на REG.RU падает
   (`order.updateMany`).
2. **Оплаты не тестировались реальными транзакциями в блокчейне.** Ни депозит, ни payout
   не прогонялись на живых деньгах — только код + HMAC-контракт.
3. **`NH8`-ветка:** спор по заказу **без Deal** (order создан без `dealId`) не доходит до
   арбитража. Проверялось только на локальной БД.
4. **`WithdrawalRequest.ledgerEntryId`** — поле есть, писателей нет.
5. **Канал алертов по webhook-сбоям** — только `logger.error`, внешнего оповещения нет.
6. **Срок рекламы** берётся из `escrow_ship_deadline_days` (5 дней) вместо `dto.days`.
7. **Нейро-слой «Базар»:** туннель `18642 → Hetzner:8642` поднят, порт отвечает
   (`/v1/models` → **401** = сервер жив, требует ключ), `BAZAR_API_KEY` в `backend/.env`
   задан. Полный end-to-end ответ LLM из прода **не проверялся** — только доступность
   (по документации, не проверял живьём сквозной ответ).
8. **Нейро-модерация fail-open:** в логах REG.RU (09.09) `LLM moderation unavailable
   (AbortError): fallback allow` — при недоступности LLM контент пропускается.
9. **Backend-тесты:** `tsc --noEmit` — 1 ошибка (`posts.controller.spec.ts:85`,
   `findById` без `req`). Jest — часть сьютов падает (DI + тот же `req`). Это
   **пред-существующее** состояние, продакшен-код без type-ошибок.
10. **`ONESIGNAL_APP_ID` локально пуст** — пуши локально мертвы; на серверах реальный UUID.
11. **`UPLOAD_BASE_URL` локально = `http://localhost:3000`** — при копировании `.env`
    на сервер **обязательно** менять на прод-домен, иначе битые картинки.
12. **Локальный логин для тестов:** админ `79000000000` / `password123`.
    Логин-эндпоинт имеет rate-limit (429) — не долбить подряд.