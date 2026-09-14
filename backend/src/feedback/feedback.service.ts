import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { ModerationService } from '../moderation/moderation.service';
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
  UpdateFeedbackDto,
} from './dto/update-feedback.dto';
import {
  FEEDBACK_ADMIN_NOTIFY_THROTTLE_MS,
  FEEDBACK_AUTOCLOSE_DAYS,
  FEEDBACK_PREVIEW_LENGTH,
  FeedbackMessageKind,
  isOpenStatus,
} from './dto/feedback-thread.dto';

/** Максимальная длина фрагмента текста в уведомлении. */
const PREVIEW_LENGTH = FEEDBACK_PREVIEW_LENGTH;

/** Роли с админским доступом к треду. */
const ADMIN_ROLES: readonly string[] = ['ADMIN', 'MODERATOR'];

/** Кто смотрит тред. */
export interface ThreadViewer {
  userId: string;
  role: string;
}

/** Сообщение в том виде, в котором оно уходит наружу. */
export interface ThreadMessageView {
  id: string;
  feedbackId: string;
  authorId: string | null;
  authorRole: string;
  authorName: string | null;
  body: string;
  kind: string;
  meta: Prisma.JsonValue | null;
  attachmentUrl: string | null;
  isReadByUser: boolean;
  isReadByAdmin: boolean;
  createdAt: Date;
}

export function isAdminRole(role?: string | null): boolean {
  return !!role && ADMIN_ROLES.includes(role);
}

/** Однострочное превью текста для списков и уведомлений. */
export function previewOf(text: string, length = PREVIEW_LENGTH): string {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
}

/**
 * «Обратная связь» — двусторонний тред пользователя с админом.
 *
 * `Feedback` — «голова треда» (тикет: статус, назначение, счётчики),
 * `FeedbackMessage` — история сообщений. Первое сообщение юзера дублируется
 * в `Feedback.message` ради обратной совместимости старых эндпоинтов.
 *
 * Инвариант счётчиков: `unreadForUser` / `unreadForAdmin` НЕ инкрементируются
 * вручную, а пересчитываются из флагов `isReadByUser` / `isReadByAdmin`
 * (см. `syncCounters`). Один источник истины — рассинхрон невозможен.
 */
@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  /**
   * Троттлинг уведомлений админам: feedbackId → timestamp последнего.
   *
   * §4.5: не чаще 1 уведомления на тред в 10 минут, иначе быстрая переписка
   * превращается в флуд. In-memory: при нескольких инстансах лимит на инстанс
   * (ослабление, не поломка — уведомление всё равно придёт).
   */
  private readonly adminNotifyAt = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly alerts: AlertsService,
    private readonly moderation: ModerationService,
  ) {}

  // ==================== Создание ====================

  /**
   * Создать обращение (тред).
   *
   * Совместимость: тело ответа — прежняя строка `Feedback` (фронт читает
   * `id`, `type`, `status`). Дополнительно создаётся первое сообщение треда.
   *
   * Уведомления — best-effort: обращение уже записано, и падение доставки
   * уведомления не должно превращать успешный POST в 500 (иначе пользователь
   * отправит его повторно и получит дубль).
   */
  async create(
    userId: string,
    dto: CreateFeedbackDto,
    /**
     * Внутренний параметр: стартовый статус треда. `WAITING_ADMIN` нужен
     * фолбэку ИИ-консультанта (§4.3), снаружи не передаётся.
     */
    initialStatus = 'NEW',
  ) {
    const body = dto.message.trim();
    const subject = dto.subject?.trim() || previewOf(body, 60);

    const feedback = await this.prisma.$transaction(async (tx) => {
      const created = await tx.feedback.create({
        data: {
          userId,
          type: dto.type,
          message: body,
          contact: dto.contact ?? null,
          subject,
          productId: dto.productId ?? null,
          source: dto.source ?? 'FORM',
          status: initialStatus,
        },
      });

      await tx.feedbackMessage.create({
        data: {
          feedbackId: created.id,
          authorId: userId,
          authorRole: 'USER',
          body,
          kind: 'TEXT',
          // Своё сообщение автору прочитано по определению; админ ещё не видел.
          isReadByUser: true,
          isReadByAdmin: false,
        },
      });

      return tx.feedback.update({
        where: { id: created.id },
        data: {
          lastMessageAt: created.createdAt,
          lastMessageBy: 'USER',
          unreadForUser: 0,
          unreadForAdmin: 1,
          adminLastReadAt: null,
          userLastReadAt: created.createdAt,
        },
      });
    });

    const label =
      FEEDBACK_TYPE_LABELS[dto.type as FeedbackType] ?? dto.type.toLowerCase();
    const preview = previewOf(body);

    await this.notifyAdminsSafely(
      `Новое обращение (${label}): ${preview}`,
      feedback.id,
    );

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

  // ==================== Списки ====================

  /**
   * Свои обращения — страницей, новые сверху.
   *
   * Форма ответа расширена (§4.4 №2), но старые поля (`items`, `total`,
   * `page`, `limit`) сохранены.
   */
  async listMine(userId: string, params: { page?: number; limit?: number }) {
    const page = clampPage(params.page, 1);
    const limit = clampLimit(params.limit, PAGINATION_BULK_LIMIT);

    const [items, total] = await Promise.all([
      this.prisma.feedback.findMany({
        where: { userId },
        orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.feedback.count({ where: { userId } }),
    ]);

    const summaries = await this.attachSummaries(items);

    return {
      items: items.map((f) => ({ ...f, ...summaries.get(f.id) })),
      total,
      page,
      limit,
    };
  }

  /**
   * Все обращения — для админки. Форма `{ items, total, page, limit }`
   * (как у остальных админ-списков), чтобы фронт мог считать `hasMore`.
   *
   * Новые фильтры (§4.4 №7): `assignedTo` (`me` | `none` | `<id>`),
   * `unreadOnly`, `q` (по теме/тексту/имени/телефону автора).
   */
  async listAll(params: {
    status?: string;
    assignedTo?: string;
    unreadOnly?: boolean;
    q?: string;
    page?: number;
    limit?: number;
    viewerId?: string;
  }) {
    const page = clampPage(params.page, 1);
    const limit = clampLimit(params.limit, PAGINATION_BULK_LIMIT);

    const where: Prisma.FeedbackWhereInput = {};
    if (params.status) {
      where.status = params.status;
    }
    if (params.unreadOnly) {
      where.unreadForAdmin = { gt: 0 };
    }
    if (params.assignedTo === 'none') {
      where.assignedAdminId = null;
    } else if (params.assignedTo === 'me') {
      // Без viewerId фильтр «мои» неопределим — отдаём пустой список,
      // а не «все» (иначе админ молча видит чужую очередь).
      where.assignedAdminId = params.viewerId ?? '__none__';
    } else if (params.assignedTo) {
      where.assignedAdminId = params.assignedTo;
    }
    if (params.q?.trim()) {
      const q = params.q.trim();
      where.OR = [
        { subject: { contains: q, mode: 'insensitive' } },
        { message: { contains: q, mode: 'insensitive' } },
        { user: { name: { contains: q, mode: 'insensitive' } } },
        { user: { phone: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.feedback.findMany({
        where,
        orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          // Телефон нужен админу для связи; passwordHash вырезан глобальным
          // omit в PrismaService, поэтому утечки через include нет.
          user: { select: { id: true, name: true, phone: true, role: true } },
          assignedAdmin: { select: { id: true, name: true, role: true } },
        },
      }),
      this.prisma.feedback.count({ where }),
    ]);

    const summaries = await this.attachSummaries(items);

    return {
      items: items.map((f) => ({ ...f, ...summaries.get(f.id) })),
      total,
      page,
      limit,
    };
  }

  /** Одно обращение. Нет — 404 (контракт: `getById` не возвращает null). */
  async getById(id: string) {
    const feedback = await this.prisma.feedback.findUnique({ where: { id } });
    if (!feedback) throw new NotFoundException('Обращение не найдено');
    return feedback;
  }

  /** Одно обращение с автором и исполнителем (для админского GET). */
  async getByIdWithUsers(id: string) {
    const feedback = await this.prisma.feedback.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, phone: true, role: true } },
        assignedAdmin: { select: { id: true, name: true, role: true } },
      },
    });
    if (!feedback) throw new NotFoundException('Обращение не найдено');
    return feedback;
  }

  // ==================== Тред ====================

  /**
   * Тред целиком (§4.4 №3 и №8).
   *
   * Доступ: автор или админ. Юзер НЕ видит сообщения `kind=NOTE` (внутренние
   * заметки). Факт открытия треда помечает его прочитанным для этой стороны —
   * так счётчики сходятся без отдельного действия пользователя.
   */
  async getThread(id: string, viewer: ThreadViewer) {
    const feedback = await this.getByIdWithUsers(id);
    const admin = isAdminRole(viewer.role);
    if (!admin && feedback.userId !== viewer.userId) {
      throw new ForbiddenException('Нет доступа к обращению');
    }

    const where: Prisma.FeedbackMessageWhereInput = { feedbackId: id };
    if (!admin) where.kind = { not: 'NOTE' };

    const messages = await this.prisma.feedbackMessage.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { author: { select: { id: true, name: true, role: true } } },
    });

    // Пометка прочитанным: для юзера — только те, что он реально видит
    // (заметки админа исключены из выборки выше).
    await this.markThreadRead(id, viewer);

    // Перечитываем с автором/исполнителем: markThreadRead меняет только
    // счётчики, но ответ треда обязан нести `user` и `assignedAdmin`
    // (админке нужен телефон автора и текущий исполнитель).
    const refreshed = await this.getByIdWithUsers(id);

    return {
      feedback: refreshed,
      messages: messages.map((m) => this.toMessageView(m)),
    };
  }

  /**
   * Ответ юзера в треде (§4.4 №4).
   *
   * Текст проходит модерацию (тот же ModerationService, что у постов и чата):
   * без этого тред стал бы дырой для обмена контактами в обход чата.
   */
  async postUserMessage(feedbackId: string, userId: string, body: string) {
    const feedback = await this.getById(feedbackId);
    if (feedback.userId !== userId) {
      throw new ForbiddenException('Нет доступа к обращению');
    }

    const text = this.resolveBody(body);
    await this.assertNotBlocked(text, userId, 'feedback');

    return this.appendMessage({
      feedbackId,
      authorId: userId,
      authorRole: 'USER',
      body: text,
      kind: 'TEXT',
    });
  }

  /**
   * Ответ админа в треде (§4.4 №9).
   *
   * `kind=NOTE` — внутренняя заметка: юзеру не видна, уведомление не шлётся,
   * статус/счётчики/lastMessageAt не трогаются.
   *
   * Автоназначение: если у треда ещё нет исполнителя и админ отвечает — он
   * становится исполнителем (иначе «мои обращения» в админке всегда пусты).
   */
  async postAdminMessage(
    feedbackId: string,
    adminId: string,
    body: string,
    kind: string = 'TEXT',
  ) {
    if (kind !== 'TEXT' && kind !== 'NOTE') {
      throw new BadRequestException('kind must be TEXT or NOTE');
    }
    await this.getById(feedbackId);
    const text = this.resolveBody(body);

    const result = await this.appendMessage({
      feedbackId,
      authorId: adminId,
      authorRole: 'ADMIN',
      body: text,
      kind: kind,
    });

    if (kind === 'TEXT') {
      // Исполнитель назначается на первом реальном ответе.
      const current = await this.prisma.feedback.findUnique({
        where: { id: feedbackId },
        select: { assignedAdminId: true },
      });
      if (current && !current.assignedAdminId) {
        await this.prisma.feedback.update({
          where: { id: feedbackId },
          data: { assignedAdminId: adminId },
        });
        result.feedback = await this.getById(feedbackId);
      }
    }

    return result;
  }

  /**
   * Отметить одно сообщение прочитанным (§4.4 №10).
   *
   * Своё сообщение отмечать нечего (оно прочитано на записи) — отдаём 200,
   * чтобы фронт не ловил 404 на гонке «отправил → сразу пометил».
   */
  async markMessageRead(
    feedbackId: string,
    messageId: string,
    viewer: ThreadViewer,
  ) {
    const feedback = await this.assertThreadAccess(feedbackId, viewer);
    const admin = isAdminRole(viewer.role) || feedback.userId !== viewer.userId;

    const message = await this.prisma.feedbackMessage.findFirst({
      where: { id: messageId, feedbackId },
    });
    if (!message) throw new NotFoundException('Сообщение не найдено');

    await this.prisma.feedbackMessage.update({
      where: { id: messageId },
      data: admin ? { isReadByAdmin: true } : { isReadByUser: true },
    });

    const counters = await this.syncCounters(feedbackId);
    const updated = await this.getById(feedbackId);
    return { ...updated, ...counters };
  }

  /** Явная отметка всего треда прочитанным (§4.4 №6). */
  async markThreadReadExplicit(feedbackId: string, viewer: ThreadViewer) {
    await this.assertThreadAccess(feedbackId, viewer);
    const counters = await this.markThreadRead(feedbackId, viewer);
    const updated = await this.getById(feedbackId);
    return { ...updated, ...counters };
  }

  /** Закрыть тред автором («Решено», §4.4 №5). */
  async closeByUser(feedbackId: string, userId: string) {
    const feedback = await this.getById(feedbackId);
    if (feedback.userId !== userId) {
      throw new ForbiddenException('Нет доступа к обращению');
    }
    return this.setClosed(feedbackId, 'CLOSED');
  }

  /** Закрыть тред админом (§4.4 №11). */
  async closeByAdmin(feedbackId: string, adminId: string) {
    await this.getById(feedbackId);
    const updated = await this.setClosed(feedbackId, 'CLOSED');
    this.logger.log(`Feedback ${feedbackId} закрыт админом ${adminId}`);
    return updated;
  }

  // ==================== Админская правка ====================

  /**
   * Смена статуса/заметки/исполнителя админом + уведомление автора.
   *
   * Автору пишем только когда реально есть что сообщить (статус сменился или
   * появилась заметка) — иначе правка «только исполнитель» слала бы пустое
   * письмо. `adminNote` (DEPRECATED) дополнительно пишется сообщением
   * kind=NOTE, чтобы история не терялась.
   */
  async update(id: string, dto: UpdateFeedbackDto, adminId: string) {
    const before = await this.getById(id);

    const data: Prisma.FeedbackUpdateInput = {};
    if (dto.status !== undefined) {
      data.status = dto.status;
      if (dto.status === 'CLOSED') {
        data.closedAt = new Date();
      }
    }
    if (dto.adminNote !== undefined) data.adminNote = dto.adminNote;
    if (dto.assignedAdminId !== undefined) {
      const assignee = dto.assignedAdminId?.trim();
      data.assignedAdmin = assignee
        ? { connect: { id: assignee } }
        : { disconnect: true };
    }

    const updated = await this.prisma.feedback.update({ where: { id }, data });

    this.logger.log(
      `Feedback ${id} обновлено админом ${adminId}: ` +
        `status=${before.status}→${updated.status}`,
    );

    const statusChanged =
      dto.status !== undefined && dto.status !== before.status;
    const noteAdded =
      dto.adminNote !== undefined &&
      !!dto.adminNote?.trim() &&
      dto.adminNote !== before.adminNote;

    // Заметка админа сохраняется в историю треда (kind=NOTE — юзеру не видна).
    if (noteAdded && updated.adminNote) {
      await this.appendMessage({
        feedbackId: id,
        authorId: adminId,
        authorRole: 'ADMIN',
        body: updated.adminNote,
        kind: 'NOTE',
      });
    }

    if (statusChanged || noteAdded) {
      const statusLabel =
        FEEDBACK_STATUS_LABELS[updated.status] ?? updated.status;
      const notePart =
        noteAdded && updated.adminNote
          ? ` Комментарий: ${previewOf(updated.adminNote, 120)}`
          : '';
      await this.notifyAuthorSafely(
        updated.userId,
        updated,
        `Ответ по вашему обращению — ${statusLabel}.${notePart}`,
      );
    }

    return updated;
  }

  /**
   * Ответ ИИ в треде (§5.2 ШАГ 5, Этап 2 ТЗ).
   *
   * Отдельный вход, а не `postAdminMessage`: автор — `AI` (kind=AI_ANSWER),
   * юзер всегда видит, что это не человек (FR-2.2). Переиспользует
   * `appendMessage`, поэтому статус (AI_HANDLED), счётчики и `lastMessageAt`
   * считаются по общим правилам §4.3, а не «руками» — рассинхрона не будет.
   *
   * Уведомление автору НЕ шлётся: это ответ на его же вопрос в его же треде,
   * push «вам ответил ИИ» через секунду после вопроса — шум. Админам тоже не
   * шлётся (правило §4.3: ИИ не дёргает админа на каждый чих).
   */
  async postAiMessage(
    feedbackId: string,
    body: string,
    meta?: Prisma.InputJsonValue,
  ) {
    const text = this.resolveBody(body);
    await this.getById(feedbackId);

    return this.appendMessage({
      feedbackId,
      authorId: null,
      authorRole: 'AI',
      body: text,
      kind: 'AI_ANSWER',
      meta,
      silent: true,
    });
  }

  /**
   * Найти открытый тред юзера, в который можно дописать ответ ИИ (§5.2 ШАГ 5).
   *
   * Условие SPEC: последнее сообщение не старше 24 часов. Закрытые треды не
   * трогаем — там разговор закончен, продолжение должно создавать новый.
   */
  async findOpenThreadForConsult(userId: string) {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return this.prisma.feedback.findFirst({
      where: {
        userId,
        status: { not: 'CLOSED' },
        lastMessageAt: { gte: cutoff },
      },
      orderBy: { lastMessageAt: 'desc' },
    });
  }

  // ==================== Статистика ====================

  /**
   * Сводка для шапки админки (§4.4 №12).
   *
   * `avgFirstResponseMin` и `aiResolvedPercent` считаются по окну последних
   * 500 тредов: точное значение по всей истории тут не нужно, а полный скан
   * на каждый рендер шапки — нужен.
   */
  async getStats() {
    const [newCount, waitingAdmin, unread] = await Promise.all([
      this.prisma.feedback.count({ where: { status: 'NEW' } }),
      this.prisma.feedback.count({ where: { status: 'WAITING_ADMIN' } }),
      this.prisma.feedback.count({ where: { unreadForAdmin: { gt: 0 } } }),
    ]);

    const threads = await this.prisma.feedback.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: {
        id: true,
        createdAt: true,
        status: true,
        messages: {
          select: { authorRole: true, kind: true, createdAt: true },
        },
      },
    });

    let firstResponseSumMs = 0;
    let firstResponseCount = 0;
    let aiResolved = 0;

    for (const t of threads) {
      const adminMsg = t.messages
        .filter((m) => m.authorRole === 'ADMIN' && m.kind !== 'NOTE')
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];

      if (adminMsg) {
        firstResponseSumMs +=
          adminMsg.createdAt.getTime() - t.createdAt.getTime();
        firstResponseCount += 1;
      } else if (
        t.status === 'AI_HANDLED' ||
        t.messages.some((m) => m.kind === 'AI_ANSWER')
      ) {
        // ИИ ответил, человек не вмешивался.
        aiResolved += 1;
      }
    }

    const avgFirstResponseMin = firstResponseCount
      ? Math.round(firstResponseSumMs / firstResponseCount / 60000)
      : 0;
    const aiResolvedPercent = threads.length
      ? Math.round((aiResolved / threads.length) * 1000) / 10
      : 0;

    return {
      new: newCount,
      waitingAdmin,
      unread,
      avgFirstResponseMin,
      aiResolvedPercent,
    };
  }

  // ==================== Cron ====================

  /**
   * §4.3 / FR-1.8: WAITING_USER + тишина 7 дней → CLOSED.
   *
   * Раз в час: чаще смысла нет (порог измеряется днями), реже — «зависшие»
   * треды висят в списке админа лишние сутки.
   */
  @Cron('0 * * * *')
  async autoCloseStaleThreads(): Promise<number> {
    const cutoff = new Date(
      Date.now() - FEEDBACK_AUTOCLOSE_DAYS * 24 * 60 * 60 * 1000,
    );

    try {
      const res = await this.prisma.feedback.updateMany({
        where: {
          status: 'WAITING_USER',
          lastMessageAt: { lt: cutoff },
          closedAt: null,
        },
        data: { status: 'CLOSED', closedAt: new Date() },
      });
      if (res.count > 0) {
        this.logger.log(`Автозакрытие обращений: ${res.count}`);
      }
      return res.count;
    } catch (err) {
      this.logger.warn(
        `Автозакрытие обращений упало: ${(err as Error).message}`,
      );
      return 0;
    }
  }

  // ==================== Внутреннее ====================

  /** Доступ к треду: автор или админ. Возвращает тред. */
  private async assertThreadAccess(feedbackId: string, viewer: ThreadViewer) {
    const feedback = await this.getById(feedbackId);
    if (!isAdminRole(viewer.role) && feedback.userId !== viewer.userId) {
      throw new ForbiddenException('Нет доступа к обращению');
    }
    return feedback;
  }

  /** Тело сообщения: `body` или алиас `text`, иначе 400. */
  private resolveBody(body: string | undefined): string {
    const text = (body ?? '').trim();
    if (!text) throw new BadRequestException('body must not be empty');
    if (text.length > 2000) {
      throw new BadRequestException('body must be at most 2000 characters');
    }
    return text;
  }

  /** Модерация текста сообщения треда (как у постов/комментариев). */
  private async assertNotBlocked(
    text: string,
    userId: string,
    entityId: string,
  ): Promise<void> {
    try {
      const verdict = await this.moderation.moderate({
        text,
        entityType: 'comment',
        entityId,
        userId,
      });
      if (verdict.verdict === 'block') {
        throw new BadRequestException(verdict.reason);
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      // Модерация недоступна — не блокируем (fail-open, как в ModerationService).
      this.logger.warn(
        `Модерация сообщения треда недоступна: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Записать сообщение и пересчитать состояние треда (§4.3).
   *
   * Правила статусов:
   *   USER  → WAITING_ADMIN (+ закрытый тред переоткрывается)
   *   ADMIN → WAITING_USER (kind=NOTE ничего не меняет)
   *   AI    → AI_HANDLED, если тред был NEW/IN_PROGRESS; WAITING_* не трогает
   */
  private async appendMessage(input: {
    feedbackId: string;
    authorId: string | null;
    authorRole: string;
    body: string;
    kind: FeedbackMessageKind;
    /** Метаданные сообщения (для AI_ANSWER — knowledgeEntryId/confidence). */
    meta?: Prisma.InputJsonValue;
    /**
     * Не слать уведомления вообще (ни автору, ни админам).
     * Нужен ответам ИИ: это ответ на вопрос юзера в его же треде, пинг
     * «вам ответил ИИ» через секунду после вопроса — шум (§4.3).
     */
    silent?: boolean;
  }) {
    const { feedbackId, authorId, authorRole, body, kind, meta, silent } =
      input;
    const isNote = kind === 'NOTE';
    const isAi = authorRole === 'AI';
    const isSystem = authorRole === 'SYSTEM';

    const created = await this.prisma.$transaction(async (tx) => {
      const message = await tx.feedbackMessage.create({
        data: {
          feedbackId,
          authorId,
          authorRole,
          body,
          kind,
          meta: meta ?? undefined,
          // Заметка админа юзеру не видна — сразу «прочитана» им, иначе
          // счётчик unreadForUser навсегда застрянет на невидимом сообщении.
          isReadByUser: authorRole === 'USER' || isNote,
          isReadByAdmin: authorRole === 'ADMIN' || isAi || isSystem,
        },
      });

      const feedback = await tx.feedback.findUnique({
        where: { id: feedbackId },
        select: { status: true, closedAt: true, createdAt: true },
      });
      if (!feedback) throw new NotFoundException('Обращение не найдено');

      let status = feedback.status;
      if (authorRole === 'USER') {
        status = 'WAITING_ADMIN';
      } else if (authorRole === 'ADMIN' && !isNote) {
        status = 'WAITING_USER';
      } else if (isAi && (status === 'NEW' || status === 'IN_PROGRESS')) {
        status = 'AI_HANDLED';
      }

      await tx.feedback.update({
        where: { id: feedbackId },
        data: {
          // NOTE — внутренняя запись: не двигает ни время, ни статус, ни счётчики.
          ...(isNote
            ? {}
            : {
                lastMessageAt: message.createdAt,
                lastMessageBy: authorRole,
              }),
          status,
          ...(authorRole === 'USER' || (authorRole === 'ADMIN' && !isNote)
            ? { closedAt: null }
            : {}),
        },
      });

      return message;
    });

    const counters = await this.syncCounters(feedbackId);
    const updated = await this.getById(feedbackId);

    // Уведомления — только для «настоящих» сообщений (не NOTE/SYSTEM)
    // и только когда вызывающий явно не попросил молчать (silent).
    if (!isNote && !isSystem && !silent) {
      if (authorRole === 'USER') {
        await this.notifyAdminsAboutUserMessage(updated);
      } else {
        await this.notifyAuthorSafely(
          updated.userId,
          updated,
          `Ответ по обращению «${updated.subject ?? previewOf(updated.message, 40)}»: ${previewOf(body)}`,
        );
      }
    }

    return {
      message: this.toMessageView({
        ...created,
        author: null,
      }),
      feedback: { ...updated, ...counters },
    };
  }

  /** Пересчёт счётчиков непрочитанного из флагов сообщений. */
  private async syncCounters(feedbackId: string) {
    const [unreadForUser, unreadForAdmin] = await Promise.all([
      this.prisma.feedbackMessage.count({
        where: { feedbackId, isReadByUser: false, kind: { not: 'NOTE' } },
      }),
      this.prisma.feedbackMessage.count({
        where: {
          feedbackId,
          isReadByAdmin: false,
          authorRole: { not: 'AI' },
        },
      }),
    ]);

    await this.prisma.feedback.update({
      where: { id: feedbackId },
      data: { unreadForUser, unreadForAdmin },
    });

    return { unreadForUser, unreadForAdmin };
  }

  /** Пометить тред прочитанным для стороны viewer'а. */
  private async markThreadRead(feedbackId: string, viewer: ThreadViewer) {
    const admin = isAdminRole(viewer.role);
    const now = new Date();

    if (admin) {
      await this.prisma.feedbackMessage.updateMany({
        where: { feedbackId, isReadByAdmin: false },
        data: { isReadByAdmin: true },
      });
      await this.prisma.feedback.update({
        where: { id: feedbackId },
        data: { adminLastReadAt: now },
      });
    } else {
      await this.prisma.feedbackMessage.updateMany({
        where: {
          feedbackId,
          isReadByUser: false,
          kind: { not: 'NOTE' },
        },
        data: { isReadByUser: true },
      });
      await this.prisma.feedback.update({
        where: { id: feedbackId },
        data: { userLastReadAt: now },
      });
    }

    return this.syncCounters(feedbackId);
  }

  /** Закрытие треда (общий путь для юзера и админа). */
  private async setClosed(feedbackId: string, status: string) {
    return this.prisma.feedback.update({
      where: { id: feedbackId },
      data: { status, closedAt: new Date() },
    });
  }

  /** lastPreview + hasAiAnswer для списков (один запрос на страницу). */
  private async attachSummaries(
    items: { id: string }[],
  ): Promise<
    Map<string, { lastPreview: string | null; hasAiAnswer: boolean }>
  > {
    const out = new Map<
      string,
      { lastPreview: string | null; hasAiAnswer: boolean }
    >();
    if (!items.length) return out;

    const ids = items.map((i) => i.id);
    const messages = await this.prisma.feedbackMessage.findMany({
      where: { feedbackId: { in: ids } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { feedbackId: true, body: true, kind: true },
    });

    for (const id of ids) {
      const mine = messages.filter((m) => m.feedbackId === id);
      const visible = mine.filter((m) => m.kind !== 'NOTE');
      out.set(id, {
        lastPreview: visible.length ? previewOf(visible[0].body) : null,
        hasAiAnswer: mine.some((m) => m.kind === 'AI_ANSWER'),
      });
    }
    return out;
  }

  private toMessageView(m: {
    id: string;
    feedbackId: string;
    authorId: string | null;
    authorRole: string;
    body: string;
    kind: string;
    meta: Prisma.JsonValue | null;
    attachmentUrl: string | null;
    isReadByUser: boolean;
    isReadByAdmin: boolean;
    createdAt: Date;
    author?: { name: string | null } | null;
  }): ThreadMessageView {
    return {
      id: m.id,
      feedbackId: m.feedbackId,
      authorId: m.authorId,
      authorRole: m.authorRole,
      authorName: m.author?.name ?? null,
      body: m.body,
      kind: m.kind,
      meta: m.meta ?? null,
      attachmentUrl: m.attachmentUrl ?? null,
      isReadByUser: m.isReadByUser,
      isReadByAdmin: m.isReadByAdmin,
      createdAt: m.createdAt,
    };
  }

  // ==================== Уведомления (§4.5) ====================

  /**
   * Внутреннее уведомление админам (+push).
   *
   * Дедупа нет намеренно: два разных обращения с одинаковым текстом — это
   * два разных обращения. `throttleKey` включает троттлинг (§4.5 п.5) для
   * сообщений внутри уже существующего треда.
   */
  private async notifyAdminsSafely(
    message: string,
    relatedId: string,
    throttleKey?: string,
  ): Promise<void> {
    try {
      if (throttleKey && this.isThrottled(throttleKey)) {
        this.logger.debug(
          `Уведомление админам по треду ${throttleKey} подавлено троттлингом`,
        );
        return;
      }

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

      if (throttleKey) this.adminNotifyAt.set(throttleKey, Date.now());

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

      // §4.5 п.2: in-app мало — без push юзер/админ узнаёт о сообщении только
      // открыв приложение. Push админам не шлём: у них рабочий стол в вебе.
    } catch (err) {
      this.logger.warn(
        `Feedback notifications to admins failed: ${(err as Error).message}`,
      );
    }
  }

  /** Уведомление автору: in-app Notification + push (§4.5 п.1-2). */
  private async notifyAuthorSafely(
    userId: string,
    feedback: { id: string; subject?: string | null; message: string },
    message: string,
  ): Promise<void> {
    try {
      await this.notifications.createNotification(
        userId,
        'feedback',
        message,
        feedback.id,
      );
      await this.notifications.sendToUser(
        userId,
        { en: 'Базар', ru: 'Базар' },
        { en: message, ru: message },
        { screen: 'feedback', feedbackId: feedback.id, type: 'feedback' },
      );
    } catch (err) {
      this.logger.warn(
        `Notification to ${userId} failed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Уведомление админам о новом сообщении юзера в треде (FR-1.6).
   *
   * Если тред уже за кем-то закреплён — дёргаем только его (иначе пятеро
   * админов получают пять одинаковых пингов). Троттлинг — 10 минут на тред.
   */
  private async notifyAdminsAboutUserMessage(feedback: {
    id: string;
    assignedAdminId?: string | null;
    subject?: string | null;
    message: string;
    userId: string;
  }): Promise<void> {
    const text = `Новое сообщение по обращению «${feedback.subject ?? previewOf(feedback.message, 40)}»`;

    if (feedback.assignedAdminId) {
      if (this.isThrottled(feedback.id)) {
        this.logger.debug(
          `Уведомление по треду ${feedback.id} подавлено троттлингом`,
        );
        return;
      }
      this.adminNotifyAt.set(feedback.id, Date.now());
      try {
        await this.notifications.createNotification(
          feedback.assignedAdminId,
          'feedback',
          text,
          feedback.id,
        );
      } catch (err) {
        this.logger.warn(
          `Notification to assignee ${feedback.assignedAdminId} failed: ${(err as Error).message}`,
        );
      }
      return;
    }

    await this.notifyAdminsSafely(text, feedback.id, feedback.id);
  }

  private isThrottled(key: string): boolean {
    const last = this.adminNotifyAt.get(key);
    if (last === undefined) return false;
    if (Date.now() - last < FEEDBACK_ADMIN_NOTIFY_THROTTLE_MS) return true;
    this.adminNotifyAt.delete(key);
    return false;
  }
}

/** Реэкспорт для консультанта (ЭТАП 2): открыт ли тред по статусу. */
export { isOpenStatus };
