import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  PAGINATION_BULK_LIMIT,
  clampLimit,
  clampPage,
} from '../common/dto/pagination.dto';

/** Тело запроса к OneSignal REST API — набор полей известен лишь провайдеру. */
type OneSignalBody = Record<string, unknown>;

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

  /**
   * N2: уведомления юзера с пагинацией.
   *
   * Раньше был жёсткий `take: 50` без параметров — у активного юзера 482
   * уведомления, 432 терялись без возможности долистать.
   *
   * ⚠️ Совместимость: ответ читается фронтом как МАССИВ (`setList(r.data||[])`).
   * Форму не меняем — по образцу `SocialService.getComments`.
   * Дефолт `PAGINATION_BULK_LIMIT` (100), а не 20: список уведомлений на фронте
   * раньше показывался сразу целиком (50 шт.), дефолт 20 обрезал бы первый экран
   * вдвое. Верхняя граница — `PAGINATION_MAX_LIMIT` через `clampLimit`.
   *
   * `orderBy` с tie-breaker по `id`: при одинаковых `createdAt` (массовые
   * broadcast-рассылки пишутся в одну миллисекунду) страницы skip/take без
   * вторичной сортировки могут дублировать или пропускать записи.
   */
  async getNotifications(
    userId: string,
    params: { page?: number; limit?: number } = {},
  ) {
    const page = clampPage(params.page, 1);
    const limit = clampLimit(params.limit, PAGINATION_BULK_LIMIT);
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
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
    data?: OneSignalBody,
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
    data?: OneSignalBody,
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

  private async sendNotification(body: OneSignalBody) {
    try {
      const response = await fetch(`${this.baseUrl}/notifications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      const result = (await response.json()) as { id?: string } & Record<string, unknown>;
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