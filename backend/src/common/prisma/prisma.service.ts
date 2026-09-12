import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { resolveTestDatabaseUrl } from './test-db-env';

/**
 * L1-ФИКС (ДЕФЕКТ 1): в тестовом прогоне клиент подключается к
 * `TEST_DATABASE_URL`, а не к боевой `DATABASE_URL`.
 *
 * URL передаётся явным `datasources.db.url` — `process.env.DATABASE_URL`
 * НЕ перезаписывается, поэтому боевой бут и ad-hoc скрипты работают как
 * раньше. См. `test-db-env.ts` (правила и предупреждения).
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const resolved = resolveTestDatabaseUrl();
    super(
      resolved.mode === 'test-db' && resolved.url
        ? { datasources: { db: { url: resolved.url } } }
        : undefined,
    );
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}