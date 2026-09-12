import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BazarRole, DealStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { BazarApiClient } from './bazar.api-client';
import { NotificationsService } from '../notifications/notifications.service';

const DAILY_LIMIT = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Фича 3: живой Базар (проактивные триггеры).
 * Каждые 15 минут ловит остывающие лиды, застывшие торги и частые просмотры.
 * Анти-спам: ProactiveEvent @@unique + лимит 3/день на юзера.
 */
@Injectable()
export class ProactiveService {
  private readonly logger = new Logger(ProactiveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly apiClient: BazarApiClient,
    private readonly notify: NotificationsService,
  ) {}

  @Cron('*/15 * * * *')
  async tick() {
    await this.nudgeColdLeads();
    await this.nudgeStuckNegotiation();
    await this.nudgeFrequentViews();
  }

  /** Лид NEW/CONTACTED без ответа продавца 48ч → напомнить инициатору (1 раз). */
  private async nudgeColdLeads() {
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const deals = await this.prisma.deal.findMany({
      where: {
        status: { in: [DealStatus.NEW, DealStatus.CONTACTED] },
        lastMsgAt: { lt: cutoff },
      },
      select: { id: true, buyerId: true, product: { select: { title: true } } },
      take: 50,
    });

    for (const deal of deals) {
      await this.nudge(
        deal.buyerId,
        'cold_lead',
        deal.id,
        `Напомнить продавцу о сделке по товару «${deal.product?.title ?? 'без названия'}»? Продавец молчит уже 48 часов.`,
      );
    }
  }

  /** NEGOTIATING застыла 24ч → обеим сторонам продолжить. */
  private async nudgeStuckNegotiation() {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const deals = await this.prisma.deal.findMany({
      where: {
        status: DealStatus.NEGOTIATING,
        lastMsgAt: { lt: cutoff },
      },
      select: { id: true, buyerId: true, sellerId: true },
      take: 50,
    });

    for (const deal of deals) {
      for (const userId of [deal.buyerId, deal.sellerId]) {
        await this.nudge(
          userId,
          'stuck_negotiation',
          deal.id,
          `Сделка ждёт ответа уже 24 часа — продолжить переговоры?`,
        );
      }
    }
  }

  /** 3+ просмотра одного товара за 7 дней → покупателю скидка. */
  private async nudgeFrequentViews() {
    const cutoff = new Date(Date.now() - 7 * DAY_MS);
    const grouped = await this.prisma.viewEvent.groupBy({
      by: ['userId', 'productId'],
      where: { createdAt: { gte: cutoff } },
      _count: { productId: true },
      having: { productId: { _count: { gte: 3 } } },
      orderBy: { _count: { productId: 'desc' } },
      take: 100,
    });

    for (const g of grouped) {
      if (g._count.productId > 5) continue; // окно 3..5 по SPEC
      const product = await this.prisma.product.findUnique({
        where: { id: g.productId },
        select: { title: true, price: true },
      });
      if (!product) continue;
      await this.nudge(
        g.userId,
        'frequent_views',
        g.productId,
        `Пользователь несколько раз смотрел товар «${product.title}» за ${product.price}. Сформулируй сообщение покупателю: предложи вернуться, можно намекнуть на скидку.`,
      );
    }
  }

  /** Единая точка проактивного сообщения с rate limit и @@unique дедупом. */
  private async nudge(
    userId: string,
    kind: string,
    refId: string,
    prompt: string,
  ) {
    try {
      // 1) @@unique — один раз на сущность.
      const existing = await this.prisma.proactiveEvent.findUnique({
        where: { userId_kind_refId: { userId, kind, refId } },
      });
      if (existing) return;

      // 2) глобальный лимит 3/день.
      const today = await this.prisma.proactiveEvent.count({
        where: { userId, createdAt: { gte: new Date(Date.now() - DAY_MS) } },
      });
      if (today >= DAILY_LIMIT) return;

      // 3) юзер одобрен.
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { isApproved: true },
      });
      if (!user || !user.isApproved) return;

      const text = await this.apiClient.complete(
        [{ role: 'user', content: prompt }],
        { sessionKey: `${userId}_proactive` },
      );

      await this.prisma.proactiveEvent.create({
        data: { userId, kind, refId },
      });
      await this.prisma.bazarMessage.create({
        data: {
          userId,
          role: BazarRole.ASSISTANT,
          text: text.text,
          meta: { proactive: true, kind },
        },
      });
      await this.notify.sendToUser(
        userId,
        { en: 'Базар' },
        { en: text.text },
        { screen: 'bazar' },
      );
    } catch (e) {
      this.logger.warn(
        `Proactive nudge failed for ${userId}/${kind}: ${(e as Error).message}`,
      );
    }
  }
}
