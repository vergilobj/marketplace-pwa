/**
 * L1-ФИКС (ДЕФЕКТ 1): глобальная уборка после прогона jest.
 *
 * Зачем, если в спеках есть afterAll: if a spec crashes mid-run (или процесс
 * убит), afterAll не выполняется и мусор остаётся. В ИЗОЛИРОВАННОЙ тестовой
 * БД это не страшно, но оставлять её грязной нельзя — следующий прогон должен
 * начинать с чистого листа. Здесь мы добиваем всё, что матчится по
 * ALL_TEST_PHONE_PREFIXES (единый список namespace'ов).
 *
 * В не-изолированном режиме (тесты против боевой БД) teardown НИЧЕГО не
 * удаляет — только сообщает, сколько тестовых пользователей осталось, чтобы
 * это не превратилось в «тихую» уборку прода по широкому префиксу.
 */
import { PrismaClient } from '@prisma/client';
import { dbNameOf, resolveTestDatabaseUrl } from '../src/common/prisma/test-db-env';
import {
  ALL_TEST_PHONE_PREFIXES,
  cleanupTestData,
} from '../src/common/prisma/test-db-cleanup';
import type { PrismaService } from '../src/common/prisma/prisma.service';

export default async function globalTeardown(): Promise<void> {
  const res = resolveTestDatabaseUrl();
  if (!res.url) return;

  const prisma = new PrismaClient({
    datasources: { db: { url: res.url } },
  });

  try {
    const leftovers = await prisma.user.count({
      where: {
        OR: ALL_TEST_PHONE_PREFIXES.map((p) => ({ phone: { startsWith: p } })),
      },
    });

    if (res.mode !== 'test-db') {
      if (leftovers > 0) {
        console.warn(
          `[jest] ВНИМАНИЕ: в БД ${dbNameOf(res.url)} осталось ${leftovers} ` +
            `тестовых пользователей. Изоляция ВЫКЛЮЧЕНА (нет TEST_DATABASE_URL) — ` +
            `глобальная уборка намеренно не выполняется, чтобы не снести ` +
            `боевые строки широким префиксом.`,
        );
      }
      return;
    }

    if (leftovers === 0) {
      console.log('[jest] тестовая БД чиста');
      return;
    }

    console.log(`[jest] глобальная уборка: ${leftovers} тестовых пользователей`);
    await cleanupTestData(prisma as unknown as PrismaService, {}, {
      prefixes: ALL_TEST_PHONE_PREFIXES,
    });

    const after = await prisma.user.count({
      where: {
        OR: ALL_TEST_PHONE_PREFIXES.map((p) => ({ phone: { startsWith: p } })),
      },
    });
    console.log(`[jest] после уборки осталось: ${after}`);
  } finally {
    await prisma.$disconnect();
  }
}