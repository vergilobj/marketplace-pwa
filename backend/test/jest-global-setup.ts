/**
 * L1-ФИКС (ДЕФЕКТ 1): готовим тестовую БД ОДИН раз на прогон jest.
 *
 * Jest вызывает globalSetup в главном процессе до форка воркеров, поэтому
 * здесь можно безопасно (без гонок между воркерами) создать БД и применить
 * миграции. Сами тесты подключаются к ней через PrismaService
 * (см. src/common/prisma/test-db-env.ts) — воркерам ничего передавать не надо,
 * они читают TEST_DATABASE_URL из backend/.env сами.
 *
 * Если TEST_DATABASE_URL не задан — ничего не делаем: тесты пойдут против
 * боевой БД, как раньше, с громким предупреждением (его печатает
 * test-db-env.ts при первом создании PrismaService).
 */
import { execFileSync } from 'child_process';
import * as path from 'path';
import {
  dbNameOf,
  resolveTestDatabaseUrl,
  TEST_DB_NAME,
} from '../src/common/prisma/test-db-env';

/** URL служебной БД `postgres` на том же сервере (для CREATE DATABASE). */
function adminUrlOf(url: string): string {
  const u = new URL(url);
  u.pathname = '/postgres';
  u.search = '';
  return u.toString();
}

function hasPsql(): boolean {
  try {
    execFileSync('psql', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export default async function globalSetup(): Promise<void> {
  const res = resolveTestDatabaseUrl();
  const backendDir = path.resolve(__dirname, '..');

  if (res.mode !== 'test-db' || !res.url) {
    console.log(
      `[jest] изоляция тестовой БД ВЫКЛЮЧЕНА (${res.reason}). ` +
        `Тесты пишут в БД ${dbNameOf(process.env.DATABASE_URL) ?? '?'} — ` +
        `это боевая база. Включить: TEST_DATABASE_URL в backend/.env ` +
        `(см. .env.example, затем bash scripts/setup-test-db.sh).`,
    );
    return;
  }

  const dbName = dbNameOf(res.url) ?? TEST_DB_NAME;
  console.log(`[jest] тестовая БД: ${dbName} (изолирована)`);

  if (!hasPsql()) {
    throw new Error(
      `[jest] TEST_DATABASE_URL задан (${dbName}), но psql не найден в PATH — ` +
        `создать тестовую БД нельзя. Установите postgresql-client или ` +
        `создайте БД вручную: createdb ${dbName} && npx prisma migrate deploy`,
    );
  }

  const adminUrl = adminUrlOf(res.url);
  const exists =
    execFileSync(
      'psql',
      ['-Atc', `select 1 from pg_database where datname = '${dbName}'`, adminUrl],
      { encoding: 'utf8' },
    ).trim() === '1';

  if (!exists) {
    console.log(`[jest] создаю тестовую БД ${dbName}`);
    execFileSync('psql', ['-c', `create database "${dbName}"`, adminUrl], {
      stdio: 'inherit',
    });
  }

  console.log(`[jest] синхронизирую схему тестовой БД ${dbName} (db push)`);
  // `migrate deploy` не годится: история миграций боевой БД несамодостаточна
  // (часть DDL сделана через `db push` и в репозиторий не попала). Схему
  // берём из schema.prisma. Тестовая БД одноразовая → --force-reset даёт
  // гарантированно чистый старт каждого прогона.
  execFileSync(
    'npx',
    ['prisma', 'db', 'push', '--force-reset', '--skip-generate', '--accept-data-loss'],
    {
      cwd: backendDir,
      env: { ...process.env, DATABASE_URL: res.url },
      stdio: 'inherit',
    },
  );
}