import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ChatService } from './chat.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
@WebSocketGateway({ cors: { origin: '*' } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(ChatGateway.name);
  private onlineUsers = new Map<string, string>(); // userId -> socketId

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private chatService: ChatService,
    private notificationsService: NotificationsService,
  ) {}

  async handleConnection(client: Socket) {
    const token = client.handshake.auth?.token;
    if (!token) {
      client.disconnect();
      return;
    }

    let payload: any;
    try {
      payload = this.jwtService.verify(token, {
        secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
    } catch (err) {
      this.logger.warn('WebSocket auth failed: invalid token');
      client.disconnect();
      return;
    }

    const userId = payload.sub;
    client.data.userId = userId;
    this.onlineUsers.set(userId, client.id);
    this.chatService.setOnline(userId, true);
    this.server.emit('userStatus', { userId, online: true });
    this.logger.log(`User ${userId} connected (socket ${client.id})`);
  }

  handleDisconnect(client: Socket) {
    for (const [uid, sid] of this.onlineUsers) {
      if (sid === client.id) {
        this.onlineUsers.delete(uid);
        this.chatService.setOnline(uid, false);
        this.server.emit('userStatus', { userId: uid, online: false });
        this.logger.log(`User ${uid} disconnected`);
        break;
      }
    }
  }

  @SubscribeMessage('sendMessage')
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      receiverId: string;
      text?: string;
      ciphertext?: string;
      file?: { url: string; name: string; type: string; size: number };
    },
  ) {
    const userId = client.data.userId as string;
    if (!userId) return;

    const text = data.text?.trim();
    const file = data.file;

    if (!text && !data.ciphertext && !file) {
      return { error: 'text_required', reason: 'Текст или файл обязателен' };
    }

    // Серверная модерация ДО сохранения (только для текстовых)
    if (text) {
      const moderation = await this.chatService.moderate(text);
      if (moderation.blocked) {
        client.emit('messageError', {
          error: 'moderated',
          reason: moderation.reason,
        });
        return { error: 'moderated', reason: moderation.reason };
      }
    }

    // Save to DB
    const msg = await this.prisma.chatMessage.create({
      data: {
        senderId: userId,
        receiverId: data.receiverId,
        text: text || null,
        ciphertext: data.ciphertext ?? null,
        fileUrl: file?.url || null,
        fileName: file?.name || null,
        fileType: file?.type || null,
        fileSize: file?.size || null,
      },
      include: {
        sender: { select: { id: true, name: true } },
      },
    });

    // Send to receiver if online
    const receiverSocketId = this.onlineUsers.get(data.receiverId);
    if (receiverSocketId) {
      this.server.to(receiverSocketId).emit('newMessage', msg);
    } else {
      // Офлайн — push + внутреннее уведомление
      const preview = text || (data.ciphertext && !file ? '🔒 Зашифрованное сообщение' : '📎 Файл');
      try {
        await this.notificationsService.createNotification(
          data.receiverId,
          'chat',
          preview,
          msg.id,
        );
        try {
          await this.notificationsService.sendToUser(
            data.receiverId,
            { en: 'Новое сообщение' },
            { en: `${msg.sender?.name || userId}: ${preview}` },
            { screen: 'chat', senderId: userId },
          );
        } catch (err) {
          this.logger.warn(
            `Push failed for user ${data.receiverId}: ${err.message}`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `Offline chat notification failed: ${err.message}`,
        );
      }
    }

    // Send back to sender for confirmation
    client.emit('messageSent', msg);

    return msg;
  }

  @SubscribeMessage('markRead')
  async handleMarkRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { senderId: string },
  ) {
    const userId = client.data.userId as string;
    if (!userId) return;
    await this.prisma.chatMessage.updateMany({
      where: { senderId: data.senderId, receiverId: userId, read: false },
      data: { read: true },
    });
  }
}