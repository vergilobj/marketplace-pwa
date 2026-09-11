import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  ForbiddenException,
  Optional,
  OnModuleInit,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EscrowStatus, OrderStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { PaymentsService } from '../payments/payments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreatePostDto } from './dto/create-post.dto';
import { CreateAdDto } from './dto/create-ad.dto';
import { ModerationService } from '../moderation/moderation.service';
import { AdActivationHook } from '../payments/ad-activation.hook';
import { addDays } from '../payments/money.util';

@Injectable()
export class PostsService implements OnModuleInit {
  private readonly logger = new Logger(PostsService.name);
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private settingsService: SettingsService,
    private paymentsService: PaymentsService,
    private notificationsService: NotificationsService,
    private moderationService: ModerationService,
    // NH5-ad: мост к payments. @Optional — юнит-тесты конструируют без него.
    @Optional() private readonly adActivation?: AdActivationHook,
  ) {}

  /**
   * NH5-ad: регистрируем в payments реакцию «депозит подтверждён → активация
   * рекламы». Раньше createAd сам подтверждал оплату без депозита — это был
   * минт на ad_price × days. Теперь единственный путь к PAID/HELD — webhook
   * депозита, а он после холда дёргает этот колбэк.
   */
  onModuleInit(): void {
    this.adActivation?.register((orderId) => this.activateAdForOrder(orderId));
  }

  async create(authorId: string, dto: CreatePostDto) {
    const moderation = await this.moderationService.moderate({
      text: [dto.title, dto.content, dto.link].filter(Boolean).join('\n'),
      entityType: 'post',
      userId: authorId,
    });
    if (moderation.verdict === 'block') {
      throw new BadRequestException(moderation.reason);
    }

    const post = await this.prisma.post.create({
      data: { ...dto, authorId },
    });

    // Notify all users about new post
    try {
      const users = await this.prisma.user.findMany({
        select: { id: true },
        where: { isApproved: true },
      });
      for (const user of users) {
        await this.notificationsService
          .createNotification(
            user.id,
            'post',
            `Новый пост: ${post.title}`,
            post.id,
          )
          .catch(() => {}); // fire-and-forget per user
      }
    } catch (e) {
      this.logger.warn('Failed to send post notifications', e);
    }

    await this.auditService.log({
      userId: authorId,
      action: 'post_created',
      entity: 'post',
      entityId: post.id,
    });

    return post;
  }

  async createAd(sellerId: string, dto: CreateAdDto) {
    const moderation = await this.moderationService.moderate({
      text: [dto.title, dto.content, dto.link].filter(Boolean).join('\n'),
      entityType: 'ad',
      userId: sellerId,
    });
    if (moderation.verdict === 'block') {
      throw new BadRequestException(moderation.reason);
    }

    const adPricePerDay =
      (await this.settingsService.getFloat('ad_price')) || 5000;
    const totalAmount = adPricePerDay * dto.days;
    const post = await this.prisma.post.create({
      data: {
        title: dto.title,
        content: dto.content,
        link: dto.link,
        authorId: sellerId,
        isAd: true,
        adOwnerId: sellerId,
        isPinned: false,
      },
    });
    const platformUser = await this.prisma.user.findFirst({
      where: { role: 'ADMIN' },
    });
    if (!platformUser)
      throw new BadRequestException('Администратор платформы не найден');
    const order = await this.prisma.order.create({
      data: {
        buyerId: sellerId,
        sellerId: platformUser.id,
        productId: null,
        amount: totalAmount,
        status: 'PENDING',
        referralUserId: null,
        referralBonus: 0,
        platformFee: totalAmount,
      },
    });
    await this.prisma.post.update({
      where: { id: post.id },
      data: { orderId: order.id },
    });
    // NH5-ad: создаём депозит-адрес и ждём РЕАЛЬНОЙ оплаты.
    //
    // Здесь БОЛЬШЕ НЕТ processSuccessfulPayment: этот вызов ставил заказ в
    // PAID + escrowStatus=HELD без депозита, реклама активировалась, а через
    // 5 дней autoCloseOrders возвращал покупателю (самому рекламодателю)
    // escrowAmount на AVAILABLE → вывод в BSC. Минт.
    //
    // Теперь оплата идёт штатным путём: заказ PENDING, escrow NONE →
    // покупатель платит на депозит-адрес → paymod-webhook сверяет сумму,
    // зовёт processSuccessfulPayment (PAID + HELD) → тот дёргает
    // AdActivationHook → реклама активируется. См. activateAdForOrder().
    await this.paymentsService.createPaymentForOrder(order.id);

    // Оплаченный срок размещения — свойство РЕКЛАМЫ, а не заказа, и поля под
    // него в схеме нет (её делят несколько билдеров). Фиксируем его в payload
    // платежа: activateAdForOrder читает `adDays` оттуда. Так срок остаётся
    // верным, даже если админ поменяет ad_price между созданием и активацией.
    const payment = await this.prisma.transaction.findFirst({
      where: { orderId: order.id, type: 'payment' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, payload: true },
    });
    if (payment) {
      const payload =
        payment.payload && typeof payment.payload === 'object'
          ? (payment.payload as Record<string, unknown>)
          : {};
      await this.prisma.transaction.update({
        where: { id: payment.id },
        data: { payload: { ...payload, adDays: dto.days } },
      });
    }

    await this.auditService.log({
      userId: sellerId,
      action: 'ad_created',
      entity: 'post',
      entityId: post.id,
    });
    return this.prisma.post.findUnique({
      where: { id: post.id },
      include: { order: true },
    });
  }

  async findAll(params: {
    page?: number;
    limit?: number;
    sort?: string;
    search?: string;
  }) {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const skip = (page - 1) * limit;
    const now = new Date();

    const orderBy: any[] = [];
    switch (params.sort) {
      case 'popular':
        orderBy.push({ likes: { _count: 'desc' } });
        break;
      case 'newest':
      default:
        orderBy.push({ isPinned: 'desc' }, { createdAt: 'desc' });
        break;
    }

    const search = params.search?.trim();
    const visibility = {
      isHidden: false,
      OR: [
        { isAd: false },
        { isAd: true, isPinned: true, adExpireDate: { gte: now } },
      ],
    };
    const where: any = search
      ? {
          AND: [
            visibility,
            {
              OR: [
                { title: { contains: search, mode: 'insensitive' } },
                { content: { contains: search, mode: 'insensitive' } },
              ],
            },
          ],
        }
      : visibility;

    const [items, total] = await Promise.all([
      this.prisma.post.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          author: { select: { id: true, name: true } },
          adOwner: { select: { id: true, name: true } },
          _count: { select: { likes: true, comments: true } },
        },
      }),
      this.prisma.post.count({ where }),
    ]);

    return {
      items: items.map((post) => ({
        ...post,
        likeCount: post._count?.likes ?? 0,
        commentCount: post._count?.comments ?? 0,
        media: post.media || [],
        _count: undefined,
      })),
      total,
      page,
      pages: Math.ceil(total / limit),
    };
  }

  async findById(id: string, userId?: string) {
    const post = await this.prisma.post.findUnique({
      where: { id },
      include: {
        author: { select: { id: true, name: true } },
        adOwner: { select: { id: true, name: true } },
        _count: { select: { likes: true, comments: true } },
        likes: userId ? { where: { userId }, take: 1 } : false,
      },
    });
    if (!post) throw new NotFoundException('Пост не найден');
    return {
      ...post,
      likeCount: post._count?.likes ?? 0,
      commentCount: post._count?.comments ?? 0,
      likedByMe: userId ? post.likes?.length > 0 : false,
      likes: undefined,
      _count: undefined,
    };
  }

  async delete(id: string) {
    await this.prisma.like.deleteMany({ where: { postId: id } });
    await this.prisma.comment.deleteMany({ where: { postId: id } });
    const deleted = await this.prisma.post.delete({ where: { id } });
    await this.auditService.log({
      action: 'post_deleted',
      entity: 'post',
      entityId: id,
    });
    return deleted;
  }

  /**
   * NH5-ad: активация рекламы ТОЛЬКО после реального депозита.
   *
   * Вызывается хуком из `PaymentsService.processSuccessfulPayment` (то есть
   * из webhook депозита paymod / легаси-IPN с проверенной суммой) — после
   * того, как заказ стал PAID и эскроу встал в HELD.
   *
   * Здесь жёсткий guard: активируем рекламу только при PAID + HELD. Раньше
   * `createAd` активировал её сразу, что и давало бесплатную рекламу + минт
   * через таймаут-возврат эскроу.
   *
   * @returns true — активировали; false — не оплачено / не рекламный заказ /
   *          уже активно.
   */
  async activateAdForOrder(orderId: string): Promise<boolean> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        escrowStatus: true,
        escrowHeldAt: true,
      },
    });
    if (!order) return false;

    if (
      order.status !== OrderStatus.PAID ||
      order.escrowStatus !== EscrowStatus.HELD
    ) {
      this.logger.warn(
        `activateAdForOrder: order ${orderId} не оплачен (${order.status}/${order.escrowStatus}) — реклама не активируется`,
      );
      return false;
    }

    const post = await this.prisma.post.findUnique({ where: { orderId } });
    if (!post) return false; // обычный товарный заказ — не наша забота

    if (post.isPinned && post.adExpireDate && post.adExpireDate > new Date()) {
      return false; // уже активна, повторный webhook/крон — no-op
    }

    // Срок размещения = ОПЛАЧЕННЫЙ срок (dto.days), а не окно эскроу.
    // Раньше здесь брался escrow_ship_deadline_days (5 дней): пользователь
    // платил за 30 дней, а реклама гасла через 5. Эскроу-окно про защиту
    // платежа (когда autoCloseOrders вернёт деньги), срок размещения — про то,
    // что куплено. Это разные вещи и они не обязаны совпадать.
    const days = await this.adDaysForOrder(orderId);
    const base = order.escrowHeldAt ?? new Date();
    const expireDate = addDays(base, days);
    await this.prisma.post.update({
      where: { id: post.id },
      data: { isPinned: true, adExpireDate: expireDate },
    });
    this.logger.log(
      `Ad post ${post.id} activated until ${expireDate.toISOString()} (order ${orderId})`,
    );
    return true;
  }

  /**
   * Оплаченный срок размещения рекламы (дни).
   *
   * В `Post` нет поля `days` (схему делят несколько билдеров — новых полей не
   * заводим), поэтому срок выводим из заказа: `amount = ad_price × days`.
   * Основной путь — `Transaction.payload.days` (пишется при создании платежа);
   * фолбэк — `round(Order.amount / ad_price)`.
   *
   * Возвращает целое >= 1; при любой неопределённости (нет заказа, нулевая
   * цена, дробный остаток) — 1 день, чтобы не выдать рекламу «на халяву».
   */
  private async adDaysForOrder(orderId: string): Promise<number> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { amount: true },
    });
    if (!order) return 1;

    const tx = await this.prisma.transaction.findFirst({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
      select: { payload: true },
    });
    const raw = tx?.payload as { adDays?: unknown; days?: unknown } | null;
    const fromPayload = Number(raw?.adDays ?? raw?.days);
    if (Number.isFinite(fromPayload) && fromPayload >= 1) {
      return Math.floor(fromPayload);
    }

    const adPrice = (await this.settingsService.getFloat('ad_price')) || 5000;
    const days = adPrice > 0 ? Math.round(order.amount / adPrice) : 1;
    return days >= 1 ? days : 1;
  }

  /**
   * NH5-ad: страховка. Если webhook подтвердил депозит, но вызов моста упал
   * (рестарт процесса между холдом и активацией) — заказ PAID + HELD, а
   * реклама не активна. Cron догоняет. Идемпотентно.
   *
   * NH9: инвариант «PAID + HELD + post != null = оплаченная реклама» не
   * ломается закрытием эскроу — рекламный заказ не переводится в COMPLETED,
   * а остаётся PAID с escrowStatus = RELEASED, поэтому сюда он уже не
   * попадает (выборка требует HELD). Условие `post: { isNot: null }` при
   * этом дополнительно гарантирует, что обычный товарный заказ, у которого
   * пост не создан, никогда не будет активирован как реклама.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async reconcilePaidAds(): Promise<{ activated: number }> {
    const orders = await this.prisma.order.findMany({
      where: {
        status: OrderStatus.PAID,
        escrowStatus: EscrowStatus.HELD,
        post: { isNot: null },
      },
      select: { id: true },
      take: 50,
    });

    let activated = 0;
    for (const o of orders) {
      try {
        if (await this.activateAdForOrder(o.id)) activated++;
      } catch (e) {
        this.logger.error(
          `reconcilePaidAds failed for order ${o.id}: ${(e as Error).message}`,
        );
      }
    }
    if (activated > 0) {
      this.logger.log(`reconcilePaidAds: activated ${activated} ad(s)`);
    }
    return { activated };
  }

  async getFeed(params: {
    userId?: string;
    page?: number;
    limit?: number;
    sort?: string;
    search?: string;
  }) {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const skip = (page - 1) * limit;
    const { userId, sort } = params;

    const now = new Date();

    const orderBy: any[] = [];
    switch (sort) {
      case 'popular':
        orderBy.push({ likes: { _count: 'desc' } });
        break;
      case 'newest':
      default:
        orderBy.push({ isPinned: 'desc' }, { createdAt: 'desc' });
        break;
    }

    // R10: серверный поиск. Условие видимости (isHidden/реклама) должно
    // сохраняться вместе с поиском — объединяем через AND.
    const search = params.search?.trim();
    const visibility = {
      isHidden: false,
      OR: [
        { isAd: false },
        { isAd: true, isPinned: true, adExpireDate: { gte: now } },
      ],
    };
    const where: any = search
      ? {
          AND: [
            visibility,
            {
              OR: [
                { title: { contains: search, mode: 'insensitive' } },
                { content: { contains: search, mode: 'insensitive' } },
              ],
            },
          ],
        }
      : visibility;

    const [items, total] = await Promise.all([
      this.prisma.post.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          author: { select: { id: true, name: true } },
          adOwner: { select: { id: true, name: true } },
          _count: { select: { likes: true, comments: true } },
          likes: userId ? { where: { userId }, take: 1 } : false,
        },
      }),
      this.prisma.post.count({ where }),
    ]);

    return {
      items: items.map((post) => ({
        ...post,
        likeCount: post._count?.likes ?? 0,
        commentCount: post._count?.comments ?? 0,
        likedByMe: userId ? post.likes?.length > 0 : false,
        media: post.media || [],
        likes: undefined,
        _count: undefined,
      })),
      total,
      page,
      pages: Math.ceil(total / limit),
    };
  }

  // Админские методы
  async findAllAdmin(params: {
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
  }) {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const skip = (page - 1) * limit;
    const where: any = {};
    if (params.search) {
      where.OR = [
        { title: { contains: params.search, mode: 'insensitive' } },
        { content: { contains: params.search, mode: 'insensitive' } },
      ];
    }
    if (params.status === 'hidden') where.isHidden = true;
    else if (params.status === 'visible') where.isHidden = false;

    const [items, total] = await Promise.all([
      this.prisma.post.findMany({
        where,
        include: {
          author: { select: { id: true, name: true } },
          adOwner: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.post.count({ where }),
    ]);
    return { items, total, page, pages: Math.ceil(total / limit) };
  }

  async toggleVisibility(id: string) {
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('Пост не найден');
    const updated = await this.prisma.post.update({
      where: { id },
      data: { isHidden: !post.isHidden },
    });
    await this.auditService.log({
      action: 'post_toggled',
      entity: 'post',
      entityId: id,
    });
    return updated;
  }

  async update(
    id: string,
    userId: string,
    userRole: string,
    data: {
      title?: string;
      content?: string;
      link?: string;
      media?: string[];
      videoUrl?: string;
    },
  ) {
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('Пост не найден');

    // Разрешить редактирование только автору или админу
    if (post.authorId !== userId && userRole !== 'ADMIN') {
      throw new ForbiddenException('Редактировать можно только свои посты');
    }

    const updated = await this.prisma.post.update({
      where: { id },
      data,
    });
    await this.auditService.log({
      userId,
      action: 'post_updated',
      entity: 'post',
      entityId: id,
    });
    return updated;
  }
}
