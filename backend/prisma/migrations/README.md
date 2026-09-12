# Prisma migrations — marketplace-pwa

⚠️ **Эта директория ОБЯЗАНА быть в git.** Она была в `.gitignore` до 2026-09-12 (аудит M1),
из-за чего ни одна миграция никогда не попадала в репозиторий, и развернуть проект
с нуля было невозможно. Правило убрано.

## Как разворачивать с нуля

```bash
cd backend
# 1. Создать пустую БД
createdb marketplace
# 2. Прописать DATABASE_URL в backend/.env
# 3. Применить миграции
npx prisma migrate deploy
# 4. Сгенерировать клиент
npx prisma generate
```

`migrate deploy` на чистой БД проходит успешно (проверено 2026-09-12 на `mp_migtest_clean`:
16 миграций, exit 0, итог совпадает со `schema.prisma` — `prisma migrate diff` пуст).

## ⚠️ `db push` vs `migrate deploy`

Исторически схема велась через `prisma db push`, а миграции писались «поверх» уже
существующей БД. Из-за этого **13 ранних миграций были несамодостаточны**: не создавали
7 enum-типов (TransactionStatus, ProductType, BazarRole, DealStatus, DealSource,
PaymentProvider, PayoutStatus), 8 таблиц (Deal, BazarMessage, ChatMessage, AuditLog,
AutopilotRun, CounterOffer, ViewEvent, ProactiveEvent) и ряд колонок.
`migrate deploy` падал на `20260911090000_money_contour` с
`type "TransactionStatus" does not exist` (SQLSTATE 42704).

Заплатка: миграция `20260911080000_missing_schema_objects` (идемпотентная, no-op на
уже существующих БД), вставленная по timestamp ПЕРЕД `money_contour`.

**Правило на будущее:**
- Новая схема → `npx prisma migrate dev --name <что_сделал>` → миграция в git.
- `prisma db push` — только для одноразовых локальных экспериментов, **никогда** на прод.
- Не редактировать уже применённые миграции (ломает checksum, Prisma откажется работать).

## Disaster recovery

Бэкап схемы без миграций = невосстановимо. Теперь схема восстанавливается из репо:
`pg_restore` дампа данных + `prisma migrate deploy` для схемы.