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

/**
 * Заглушки, которые НЕ являются валидным OneSignal App ID.
 *
 * `test` (текущее значение в backend/.env) и пустая строка раньше молча
 * проходили в `hasKeys`: `Boolean('test' && key)` → true, сервис «думал», что
 * настроен, и падал на каждом пуше уже внутри OneSignal API. Пуш при этом был
 * мёртв, а в логе — ничего на старте.
 */
const ONESIGNAL_PLACEHOLDER_APP_IDS = new Set(['test', 'change_me', 'changeme']);

/**
 * Валиден ли OneSignal App ID.
 *
 * Реальный App ID — UUID вида `d1cb2724-f8e5-40c4-8dec-2db841c83cba`.
 * Требуем UUID-форму: это отсекает и `test`, и случайно вставленный REST API
 * ключ, и обрезанное значение.
 */
function isValidOneSignalAppId(appId: string | undefined): boolean {
  if (!appId) return false;
  const trimmed = appId.trim();
  if (!trimmed) return false;
  if (ONESIGNAL_PLACEHOLDER_APP_IDS.has(trimmed.toLowerCase())) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    trimmed,
  );
}

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

    // G2: явный warn при старте вместо тихого no-op.
    //
    // Было: при `ONESIGNAL_APP_ID=test` сервис уходил в ветку `hasKeys=false`
    // и на каждый push молча возвращал null. Ни одной строки в логе на старте —
    // деплой на прод с заглушкой ничем не отличался от корректного.
    // Стало: невалидный/заглушечный app_id виден в логе сразу при бустрапе.
    this.warnIfPushDisabled();
  }

  /**
   * Один warn на старте, если пуши фактически выключены. Не бросает —
   * отсутствие пушей не должно мешать приложению подняться.
   */
  private warnIfPushDisabled(): void {
    if (this.isPushConfigured) return;

    const reasons: string[] = [];
    if (!this.appId || !this.appId.trim()) {
      reasons.push('ONESIGNAL_APP_ID не задан');
    } else if (!isValidOneSignalAppId(this.appId)) {
      reasons.push(
        `ONESIGNAL_APP_ID не похож на реальный App ID (получено: ` +
          `"${this.appId.trim().slice(0, 32)}")`,
      );
    }
    if (!this.apiKey || !this.apiKey.trim()) {
      reasons.push('ONESIGNAL_REST_API_KEY не задан');
    }

    this.logger.warn(
      `OneSignal не настроен — пуш отключён. ${reasons.join('; ')}. ` +
        `Пропишите реальный ONESIGNAL_APP_ID (UUID) и ONESIGNAL_REST_API_KEY ` +
        `в backend/.env; App ID — OneSignal Dashboard → Settings → Keys & IDs. ` +
        `См. DEPLOY.md §4.1.`,
    );
  }

  /** Готов ли сервис реально отправлять пуши. */
  private get isPushConfigured(): boolean {
    return isValidOneSignalAppId(this.appId) && Boolean(this.apiKey?.trim());
  }

  private get hasKeys(): boolean {
    return this.isPushConfigured;
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