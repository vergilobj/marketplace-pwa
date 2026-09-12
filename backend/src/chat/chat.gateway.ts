/**
 * DEPRECATED — p2p-чат отключён 2026-09-11 (Э4-backend), заменён на Базар.
 * Вся коммуникация теперь через ИИ-агента Базара (BazarModule + DealService).
 *
 * Класс сохранён как историческая справка: декораторы
 * @WebSocketGateway/@SubscribeMessage убраны, socket.io namespace больше не
 * регистрируется. Файл НЕ удаляется намеренно, но фронт не может слать сюда
 * сообщения.
 */
import { Injectable } from '@nestjs/common';

@Injectable()
export class ChatGateway {
  // Отключено. Gateway больше не регистрируется в ChatModule и не импортируется в AppModule.
}
