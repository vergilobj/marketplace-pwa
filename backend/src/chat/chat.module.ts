import { Module } from '@nestjs/common';

/**
 * DEPRECATED — p2p-чат отключён (Э4-backend).
 * ChatModule больше не подключается в AppModule.
 * Модуль оставлен как заглушка; gateway и controller выключены.
 */
@Module({
  controllers: [],
  providers: [],
})
export class ChatModule {}