import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AlertsService } from '../common/alerts/alerts.service';
import {
  PAGINATION_BULK_LIMIT,
  clampLimit,
  clampPage,
} from '../common/dto/pagination.dto';
import {
  CreateFeedbackDto,
  FEEDBACK_TYPE_LABELS,
  FeedbackType,
} from './dto/create-feedback.dto';
import {
  FEEDBACK_STATUS_LABELS,
  FeedbackStatus,
  UpdateFeedbackDto,
} from './dto/update-feedback.dto';

/** Максимальная длина фрагмента текста в уведомлении. */
const PREVIEW_LENGTH = 80;

/**
 * «Обратная связь» — связь пользователя с админом.
 *
 * Поток: пользователь пишет обращение → все ADMIN получают внутреннее
 * уведомление + внешний алерт (если задан ALERT_WEBHOOK_URL) → админ меняет
 * статус/пишет заметку → автор получает уведомление об ответе.
 */
@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly alerts: AlertsService,
  ) {}

  /**
   * Создать обращение.
   *
   * Уведомления — best-effort: обращение уже записано, и падение доставки
   * уведомления не должно превращать успешный POST в 500 (иначе пользователь
   * отправит его повторно и получит дубль).
   */
  async create(userId: string, dto: CreateFeedbackDto) {
    const feedback = await this.prisma.feedback.create({
      data: {
        userId,
        type: dto.type,
        message: dto.message,
        contact: dto.contact ?? null,
      },
    });

    const label =
      FEEDBACK_TYPE_LABELS[dto.type as FeedbackType] ?? dto.type.toLowerCase();
    const preview = dto.message.trim().slice(0, PREVIEW_LENGTH);
    const adminMessage = `Новое обращение (${label}): ${preview}`;

    await this.notifyAdminsSafely(adminMessage, feedback.id);

    // Внешний канал (Егору и оркестратору). AlertsService никогда не бросает
    // и сам молча уходит в debug-лог, если ALERT_WEBHOOK_URL не задан.
    await this.alerts.send({
      code: 'feedback_created',
      message: `Обращение (${label}) от ${feedback.userId}: ${preview}`,
      context: {
        feedbackId: feedback.id,
        userId: feedback.userId,
        type: dto.type,
        contact: dto.contact ?? null,
      },
      severity: 'warning',
    });

    return feedback;
  }

  /** Свои обращения — страницей, новые сверху. */
  async listMine(userId: string, params: { page?: number; limit?: number }) {
    const page = clampPage(params.page, 1);
    const limit = clampLimit(params.limit, PAGINATION_BULK_LIMIT);

    const [items, total] = await Promise.all([
      this.prisma.feedback.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.feedback.count({ where: { userId } }),
    ]);

    return { items, total, page, limit };
  }

  /**
   * Все обращения — для админки. Форма ответа `{ items, total, page, limit }`
   * (как у остальных админ-списков), чтобы фронт мог считать `hasMore`.
   */
  async listAll(params: {
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const page = clampPage(params.page, 1);
    const limit = clampLimit(params.limit, PAGINATION_BULK_LIMIT);
    const where = params.status ? { status: params.status } : {};

    const [items, total] = await Promise.all([
      this.prisma.feedback.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          // Телефон нужен админу для связи; passwordHash вырезан глобальным
          // omit в PrismaService, поэтому утечки через include нет.
          user: { select: { id: true, name: true, phone: true, role: true } },
        },
      }),
      this.prisma.feedback.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  /** Одно обращение. Нет — 404 (контракт: `getById` не возвращает null). */
  async getById(id: string) {
    const feedback = await this.prisma.feedback.findUnique({ where: { id } });
    if (!feedback) throw new NotFoundException('Обращение не найдено');
    return feedback;
  }

  /**
   * Смена статуса/заметки админом + уведомление автора.
   *
   * Автору пишем только когда реально есть что сообщить (статус сменился или
   * появилась заметка) — иначе правка «только заметка» слала бы пустое письмо.
   */
  async update(id: string, dto: UpdateFeedbackDto, adminId: string) {
    const before = await this.getById(id);

    const updated = await this.prisma.feedback.update({
      where: { id },
      data: {
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.adminNote !== undefined ? { adminNote: dto.adminNote } : {}),
      },
    });

    this.logger.log(
      `Feedback ${id} обновлено админом ${adminId}: ` +
        `status=${before.status}→${updated.status}`,
    );

    const statusChanged =
      dto.status !== undefined && dto.status !== before.status;
    const noteAdded =
      dto.adminNote !== undefined && dto.adminNote !== before.adminNote;

    if (statusChanged || noteAdded) {
      const statusLabel =
        FEEDBACK_STATUS_LABELS[updated.status as FeedbackStatus] ??
        updated.status;
      const notePart = noteAdded && updated.adminNote
        ? ` Комментарий: ${updated.adminNote}`
        : '';
      await this.notifySafely(
        updated.userId,
        'feedback',
        `Ответ по вашему обращению — ${statusLabel}.${notePart}`,
        updated.id,
      );
    }

    return updated;
  }

  /**
   * Внутреннее уведомление всем ADMIN.
   *
   * Дедупа нет намеренно: два разных обращения с одинаковым текстом — это
   * два разных обращения, их нельзя склеивать (в отличие от cron-алертов
   * инвариантов, которые повторяются каждые 10 минут).
   */
  private async notifyAdminsSafely(
    message: string,
    relatedId: string,
  ): Promise<void> {
    try {
      const admins = await this.prisma.user.findMany({
        where: { role: UserRole.ADMIN },
        select: { id: true },
      });

      if (!admins.length) {
        this.logger.error(
          `No ADMIN users found — feedback notification not delivered: ${message}`,
        );
        return;
      }

      await Promise.all(
        admins.map((admin) =>
          this.notifications
            .createNotification(admin.id, 'feedback', message, relatedId)
            .catch((err: Error) =>
              this.logger.warn(
                `Feedback notification to admin ${admin.id} failed: ${err.message}`,
              ),
            ),
        ),
      );
    } catch (err) {
      this.logger.warn(
        `Feedback notifications to admins failed: ${(err as Error).message}`,
      );
    }
  }

  /** Уведомление пользователю — тоже не роняем запрос из-за его сбоя. */
  private async notifySafely(
    userId: string,
    type: string,
    message: string,
    relatedId?: string,
  ): Promise<void> {
    try {
      await this.notifications.createNotification(
        userId,
        type,
        message,
        relatedId,
      );
    } catch (err) {
      this.logger.warn(
        `Notification to ${userId} failed: ${(err as Error).message}`,
      );
    }
  }
}