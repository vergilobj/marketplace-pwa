/**
 * L1-ФИКС (ДЕФЕКТ 1): изоляция тестовой БД.
 *
 * Проблема, доказанная на живой базе: 11 спек-файлов делают
 * `new PrismaService()` → `PrismaClient` читает `DATABASE_URL` из
 * `backend/.env` → интеграционные тесты пишут в БОЕВУЮ БД `marketplace`.
 * Точечный `cleanupTestData` по id/префиксам проблему не закрывает: тест,
 * упавший до `afterAll`, оставляет мусор, а «бесхозная» проводка
 * (`LedgerEntry` с `userId=null`, `orderId=null`, refKey вида
 * `escrow_release:<uuid>:ESCROW`) не находится ни по пользователю, ни по
 * заказу — именно она ломала `verifyInvariants` (`ok=false problems=1`).
 *
 * Решение (вариант A из ТЗ): отдельная схема/БД для тестов через
 * `TEST_DATABASE_URL`. Тесты подключаются к ней; если переменной нет —
 * работаем как раньше (чтобы не сломать локальную разработку), но громко
 * предупреждаем.
 *
 * Жёсткие правила безопасности:
 *  1. Тестовая БД подключается ТОЛЬКО в тестовом прогоне
 *     (`JEST_WORKER_ID` / `NODE_ENV=test` / явный `FORGE_FORCE_TEST_DB=1`).
 *     Боевой бут (`node dist/src/main.js`) всегда идёт на `DATABASE_URL`.
 *  2. Если `TEST_DATABASE_URL` указывает на ТУ ЖЕ БД, что `DATABASE_URL`
 *     (например, кто-то прописал туда `marketplace`) — изоляция не
 *     включается, выводится предупреждение. Иначе «защита» была бы
 *     фикцией, а тесты продолжили бы убивать боевые данные.
 *  3. `DATABASE_URL` никогда не переписывается в `process.env` — тестовая
 *     БД передаётся в `PrismaClient` явным `datasources.db.url`, поэтому
 *     ad-hoc скрипты (`scripts/money-e2e.ts`, `k1-*.ts`), запускаемые вне
 *     jest, по-прежнему бьют в боевую БД — это их штатное поведение.
 */
import * as path from 'path';
import * as dotenv from 'dotenv';

/** Имя схемы тестовой БД. Совпадает с `TEST_DATABASE_URL` в `.env.example`. */
export const TEST_DB_NAME = 'marketplace_test';

export type TestDbMode = 'test-db' | 'dev-db';

export interface TestDbResolution {
  /** 'test-db' — тесты изолированы; 'dev-db' — работаем против боевой БД. */
  mode: TestDbMode;
  /** URL, который надо отдать PrismaClient. */
  url: string | undefined;
  /** Человекочитаемая причина решения (для лога/диагностики). */
  reason: string;
}

let cached: TestDbResolution | null = null;
let warned = false;

/** Разбор имени БД из connection string. */
export function dbNameOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const name = new URL(url).pathname.replace(/^\/+/, '');
    return name || null;
  } catch {
    return null;
  }
}

/**
 * Загружаем `backend/.env`. `@prisma/client` в v6 `.env` сам не читает,
 * поэтому до теста `DATABASE_URL` доезжает только через явный dotenv
 * (раньше это работало «случайно» — через переменные окружения шелла).
 * Существующие переменные процесса НЕ перезаписываются (dotenv default).
 */
function loadBackendEnv(): void {
  const g = globalThis as unknown as { __FORGE_ENV_LOADED__?: boolean };
  if (g.__FORGE_ENV_LOADED__) return;
  g.__FORGE_ENV_LOADED__ = true;

  const candidates = [
    path.resolve(__dirname, '../../../.env'), // src/common/prisma → backend/.env
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'backend/.env'),
  ];
  for (const p of candidates) {
    try {
      dotenv.config({ path: p });
    } catch {
      /* файла нет — не наша проблема */
    }
  }
}

/** Идёт ли сейчас тестовый прогон (jest / явный форс). */
export function isTestRun(): boolean {
  if (process.env.FORGE_FORCE_TEST_DB === '1') return true;
  if (process.env.JEST_WORKER_ID) return true;
  if (process.env.NODE_ENV === 'test') return true;
  return false;
}

function warnOnce(res: TestDbResolution): void {
  if (warned) return;
  warned = true;
  if (res.mode === 'test-db') return;

  const devDb = dbNameOf(process.env.DATABASE_URL) ?? '<unknown>';
  /* eslint-disable no-console */
  console.warn(
    [
      '',
      '╔══════════════════════════════════════════════════════════════════════╗',
      '║  ⚠  ТЕСТЫ РАБОТАЮТ ПРОТИВ БОЕВОЙ БД — ИЗОЛЯЦИЯ НЕ ВКЛЮЧЕНА            ║',
      '╠══════════════════════════════════════════════════════════════════════╣',
      `║  причина: ${res.reason.padEnd(58).slice(0, 58)}║`,
      `║  боевая БД: ${devDb.padEnd(56).slice(0, 56)}║`,
      '║                                                                      ║',
      '║  Как включить изоляцию:                                              ║',
      `║    TEST_DATABASE_URL=postgresql://...:5432/${TEST_DB_NAME.padEnd(33)}║`,
      '║    bash scripts/setup-test-db.sh   # создаст БД и применит миграции  ║',
      '╚══════════════════════════════════════════════════════════════════════╝',
      '',
    ].join('\n'),
  );
  /* eslint-enable no-console */
}

/**
 * Итоговое решение: какой URL отдавать PrismaClient.
 * Кэшируется на процесс (jest-воркер).
 */
export function resolveTestDatabaseUrl(): TestDbResolution {
  if (cached) return cached;
  loadBackendEnv();

  const testUrl = process.env.TEST_DATABASE_URL?.trim() || undefined;
  const devUrl = process.env.DATABASE_URL;
  const inTest = isTestRun();

  let res: TestDbResolution;
  if (!inTest) {
    res = {
      mode: 'dev-db',
      url: devUrl,
      reason: 'не тестовый прогон (нет JEST_WORKER_ID/NODE_ENV=test)',
    };
  } else if (!testUrl) {
    res = {
      mode: 'dev-db',
      url: devUrl,
      reason: 'TEST_DATABASE_URL не задан',
    };
  } else if (dbNameOf(testUrl) === dbNameOf(devUrl)) {
    res = {
      mode: 'dev-db',
      url: devUrl,
      reason: 'TEST_DATABASE_URL указывает на ТУ ЖЕ БД, что DATABASE_URL',
    };
  } else {
    res = { mode: 'test-db', url: testUrl, reason: 'TEST_DATABASE_URL' };
  }

  cached = res;
  if (inTest) warnOnce(res);
  return res;
}

/** Сброс кэша — нужен тестам самого резолвера. */
export function __resetTestDbEnvCache(): void {
  cached = null;
  warned = false;
}