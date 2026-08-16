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

@Injectable()
@WebSocketGateway({ cors: { origin: '*' } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(ChatGateway.name);
  private onlineUsers = new Map<string, string>(); // userId -> socketId

  constructor(private prisma: PrismaService) {}

  async handleConnection(client: Socket) {
    const userId = client.handshake.query.userId as string;
    if (userId) {
      this.onlineUsers.set(userId, client.id);
      this.logger.log(`User ${userId} connected (socket ${client.id})`);
    }
  }

  handleDisconnect(client: Socket) {
    for (const [uid, sid] of this.onlineUsers) {
      if (sid === client.id) {
        this.onlineUsers.delete(uid);
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
      file?: { url: string; name: string; type: string; size: number };
    },
  ) {
    const userId = client.handshake.query.userId as string;
    if (!userId) return;

    // Save to DB
    const msg = await this.prisma.chatMessage.create({
      data: {
        senderId: userId,
        receiverId: data.receiverId,
        text: data.text || null,
        fileUrl: data.file?.url || null,
        fileName: data.file?.name || null,
        fileType: data.file?.type || null,
        fileSize: data.file?.size || null,
      },
      include: {
        sender: { select: { id: true, name: true } },
      },
    });

    // Send to receiver if online
    const receiverSocketId = this.onlineUsers.get(data.receiverId);
    if (receiverSocketId) {
      this.server.to(receiverSocketId).emit('newMessage', msg);
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
    const userId = client.handshake.query.userId as string;
    if (!userId) return;
    await this.prisma.chatMessage.updateMany({
      where: { senderId: data.senderId, receiverId: userId, read: false },
      data: { read: true },
    });
  }
}
