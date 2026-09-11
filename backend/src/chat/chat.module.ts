import { Module } from '@nestjs/common';

/**
 * DEPRECATED — p2p-чат отключён 2026-09-11 (Э4-backend), заменён на Базар.
 * ChatModule больше не подключается в AppModule.
 * Модуль пуст: gateway и controller выключены.
 */
@Module({
  controllers: [],
  providers: [],
})
export class ChatModule {}