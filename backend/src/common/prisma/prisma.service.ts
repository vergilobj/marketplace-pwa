import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { resolveTestDatabaseUrl } from './test-db-env';

/**
 * L1-ФИКС (ДЕФЕКТ 1): в тестовом прогоне клиент подключается к
 * `TEST_DATABASE_URL`, а не к боевой `DATABASE_URL`.
 *
 * URL передаётся явным `datasources.db.url` — `process.env.DATABASE_URL`
 * НЕ перезаписывается, поэтому боевой бут и ad-hoc скрипты работают как
 * раньше. См. `test-db-env.ts` (правила и предупреждения).
 *
 * SECURITY (FIX-CRIT): глобальный `omit` для `User.passwordHash`.
 *
 * Раньше `prisma.user.findUnique({ where: { phone } })` без `select`
 * возвращал ВСЮ строку, и `GET /api/users/search` отдавал bcrypt-хеш
 * любого пользователя (включая ADMIN) любому авторизованному — утечка
 * подтверждена живьём на проде.
 *
 * Теперь `passwordHash` вырезается на уровне клиента: он не может утечь
 * из НИ ОДНОГО запроса, даже если кто-то забудет `select`. Явные
 * `select` без `passwordHash` работают как раньше (omit + select
 * взаимно дополняются: omit применяется к результату select).
 *
 * Места, которым хеш РЕАЛЬНО нужен (проверка пароля в `AuthService`),
 * запрашивают его обратно через `omit: { passwordHash: false }`.
 *
 * Требует Prisma >= 5.16 (здесь 6.19.3).
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const resolved = resolveTestDatabaseUrl();

    const options: Prisma.PrismaClientOptions = {
      omit: { user: { passwordHash: true } },
    };

    if (resolved.mode === 'test-db' && resolved.url) {
      options.datasources = { db: { url: resolved.url } };
    }

    super(options);
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}