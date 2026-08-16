import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly appId: string | undefined;
  private readonly apiKey: string | undefined;
  private readonly baseUrl = 'https://onesignal.com/api/v1';

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    this.appId = this.configService.get<string>('ONESIGNAL_APP_ID');
    this.apiKey = this.configService.get<string>('ONESIGNAL_REST_API_KEY');
  }

  private get hasKeys(): boolean {
    return Boolean(this.appId && this.apiKey);
  }

  // ================== Внутренние уведомления ==================

  async createNotification(
    userId: string,
    type: string,
    message: string,
    relatedId?: string,
  ) {
    try {
      return await this.prisma.notification.create({
        data: { userId, type, message, relatedId },
      });
    } catch (err) {
      this.logger.error(
        `Failed to create notification for user ${userId}: ${err.message}`,
      );
      return null;
    }
  }

  async getNotifications(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async markAsRead(id: string, userId: string) {
    return this.prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true },
    });
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, isRead: false },
    });
  }

  // ================== Push-уведомления (существующие) ==================

  async sendToAll(
    headings: Record<string, string>,
    contents: Record<string, string>,
    data?: any,
  ) {
    if (!this.hasKeys) {
      this.logger.warn('OneSignal keys missing — push skipped');
      return null;
    }
    const body = {
      app_id: this.appId,
      included_segments: ['All'],
      headings,
      contents,
      data,
    };
    return this.sendNotification(body);
  }

  async sendToUser(
    userId: string,
    headings: Record<string, string>,
    contents: Record<string, string>,
    data?: any,
  ) {
    if (!this.hasKeys) {
      this.logger.warn('OneSignal keys missing — push skipped');
      return null;
    }
    const body = {
      app_id: this.appId,
      include_external_user_ids: [userId],
      headings,
      contents,
      data,
    };
    return this.sendNotification(body);
  }

  private async sendNotification(body: any) {
    try {
      const response = await fetch(`${this.baseUrl}/notifications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      const result = await response.json();
      if (!response.ok) {
        this.logger.error(`OneSignal error: ${JSON.stringify(result)}`);
      } else {
        this.logger.log(`Notification sent: ${result.id}`);
      }
      return result;
    } catch (error) {
      this.logger.error('Failed to send notification', error);
      throw error;
    }
  }

  async markAllAsRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  }
}