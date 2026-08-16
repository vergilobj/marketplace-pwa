import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  Request,
  UseInterceptors,
  UploadedFile,
  Body,
  Headers,
  HttpCode,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../common/types/authenticated-request.interface';
import { PrismaService } from '../common/prisma/prisma.service';
import { ChatService } from './chat.service';
import { ConfigService } from '@nestjs/config';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { v4 as uuid } from 'uuid';

@Controller('chat')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    private prisma: PrismaService,
    private chatService: ChatService,
    private configService: ConfigService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get('conversations')
  async getConversations(@Request() req: AuthenticatedRequest) {
    const userId = req.user.userId;

    // Get unique users this user has chatted with
    const messages = await this.prisma.chatMessage.findMany({
      where: {
        OR: [{ senderId: userId }, { receiverId: userId }],
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: {
        sender: { select: { id: true, name: true } },
        receiver: { select: { id: true, name: true } },
      },
    });

    // Group by conversation partner
    const conversations = new Map<string, any>();
    for (const msg of messages) {
      const partnerId = msg.senderId === userId ? msg.receiverId : msg.senderId;
      if (!conversations.has(partnerId)) {
        const partner = msg.senderId === userId ? msg.receiver : msg.sender;
        conversations.set(partnerId, {
          userId: partnerId,
          name: partner.name || partnerId,
          lastMessage: msg.text || (msg.fileUrl ? '📎 Файл' : ''),
          lastMessageTime: msg.createdAt,
          unread: msg.senderId !== userId && !msg.read ? 1 : 0,
        });
      } else if (msg.senderId !== userId && !msg.read) {
        conversations.get(partnerId).unread++;
      }
    }

    return Array.from(conversations.values());
  }

  @UseGuards(JwtAuthGuard)
  @Get('messages/:userId')
  async getMessages(
    @Request() req: AuthenticatedRequest,
    @Param('userId') otherUserId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const userId = req.user.userId;
    const p = Number(page) || 1;
    const l = Number(limit) || 50;

    const [items, total] = await Promise.all([
      this.prisma.chatMessage.findMany({
        where: {
          OR: [
            { senderId: userId, receiverId: otherUserId },
            { senderId: otherUserId, receiverId: userId },
          ],
        },
        orderBy: { createdAt: 'desc' },
        skip: (p - 1) * l,
        take: l,
        include: {
          sender: { select: { id: true, name: true } },
        },
      }),
      this.prisma.chatMessage.count({
        where: {
          OR: [
            { senderId: userId, receiverId: otherUserId },
            { senderId: otherUserId, receiverId: userId },
          ],
        },
      }),
    ]);

    return {
      items: items.reverse(),
      total,
      page: p,
      pages: Math.ceil(total / l),
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: join(process.cwd(), 'uploads', 'chat'),
        filename: (_req, file, cb) => {
          const name = uuid() + extname(file.originalname);
          cb(null, name);
        },
      }),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    }),
  )
  async uploadFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) return { error: 'No file' };
    return {
      url: `/uploads/chat/${file.filename}`,
      name: file.originalname,
      type: file.mimetype,
      size: file.size,
    };
  }

  @Post('webhook')
  @HttpCode(200)
  async handleWebhook(
    @Body() body: any,
    @Headers('x-cometchat-signature') signature: string,
  ) {
    const secret = this.configService.getOrThrow<string>(
      'COMETCHAT_WEBHOOK_SECRET',
    );

    // TODO: verify HMAC signature when CometChat provides the algorithm
    // For now, accept if signature header matches secret (basic check)
    if (!signature || signature !== secret) {
      this.logger.warn('Webhook rejected: invalid signature');
      return { status: 'rejected', reason: 'invalid_signature' };
    }

    const result = await this.chatService.moderateMessage(body);
    return result;
  }
}
