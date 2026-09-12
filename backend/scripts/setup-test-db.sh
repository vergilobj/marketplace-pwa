#!/usr/bin/env bash
#
# L1-ФИКС (ДЕФЕКТ 1): подготовка изолированной тестовой БД.
#
# Создаёт БД из `TEST_DATABASE_URL` (по умолчанию — marketplace_test на том же
# сервере, что и боевая) и применяет к ней prisma-миграции. Идемпотентен:
# повторный запуск ничего не ломает.
#
# Использование:
#   bash scripts/setup-test-db.sh
#
# Правила безопасности:
#   * если TEST_DATABASE_URL не задан — скрипт НИЧЕГО не создаёт и выходит 0
#     (тесты пойдут против боевой БД с громким предупреждением);
#   * если TEST_DATABASE_URL совпадает с DATABASE_URL — выход 1 с ошибкой
#     (иначе «изоляция» была бы фикцией).
set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$BACKEND_DIR"

env_value() {
  # env_value KEY [FILE] — значение из окружения или из .env
  local key="$1" file="${2:-.env}"
  if [ -n "${!key:-}" ]; then
    printf '%s' "${!key}"
    return 0
  fi
  if [ -f "$file" ]; then
    grep -m1 "^${key}=" "$file" 2>/dev/null | cut -d= -f2- || true
  fi
}

DEV_URL="$(env_value DATABASE_URL)"
TEST_URL="$(env_value TEST_DATABASE_URL)"

if [ -z "${TEST_URL}" ]; then
  echo "[setup-test-db] TEST_DATABASE_URL не задан — изоляция тестов ВЫКЛЮЧЕНА." >&2
  echo "[setup-test-db] Пропишите его в backend/.env, см. .env.example." >&2
  exit 0
fi

if [ "${TEST_URL}" = "${DEV_URL}" ]; then
  echo "[setup-test-db] ОШИБКА: TEST_DATABASE_URL == DATABASE_URL." >&2
  echo "[setup-test-db] Тестовая БД обязана быть отдельной (см. .env.example)." >&2
  exit 1
fi

TEST_DB="${TEST_URL##*/}"
TEST_DB="${TEST_DB%%\?*}"
ADMIN_URL="${TEST_URL%/*}/postgres"

if ! command -v psql >/dev/null 2>&1; then
  echo "[setup-test-db] ОШИБКА: psql не найден в PATH." >&2
  exit 1
fi

exists="$(psql "$ADMIN_URL" -Atc "select 1 from pg_database where datname = '${TEST_DB}'" 2>/dev/null || true)"
if [ "${exists}" != "1" ]; then
  echo "[setup-test-db] создаю БД ${TEST_DB}"
  psql "$ADMIN_URL" -c "create database \"${TEST_DB}\"" >/dev/null
else
  echo "[setup-test-db] БД ${TEST_DB} уже существует"
fi

echo "[setup-test-db] синхронизирую схему с schema.prisma (db push --force-reset)"
# ⚠️ `prisma migrate deploy` здесь НЕ работает: история миграций боевой БД
# несамодостаточна (часть DDL делалась через `db push` и в репозиторий не
# попала — например, enum "TransactionStatus" создан вне миграций). Поэтому
# схему тестовой БД берём напрямую из schema.prisma. Тестовая БД —
# одноразовая, поэтому --force-reset безопасен и заодно даёт чистый старт.
DATABASE_URL="${TEST_URL}" npx prisma db push --force-reset --skip-generate

echo "[setup-test-db] готово: ${TEST_DB}"