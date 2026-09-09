/**
 * DEPRECATED — p2p-чат отключён (Э4-backend).
 * Вся коммуникация теперь через ИИ-агента Базара (BazarModule + DealService).
 *
 * Класс оставлен как заглушка: декораторы @WebSocketGateway/@SubscribeMessage
 * убраны, socket.io namespace больше не регистрируется. Файл НЕ удаляется
 * намеренно (историческая справка), но фронт не может слать сюда сообщения.
 */
import { Injectable } from '@nestjs/common';

@Injectable()
export class ChatGateway {
  // Отключено. Gateway больше не регистрируется в ChatModule и не импортируется в AppModule.
}