import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { DealStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Автозакрытие зависших сделок (SPEC §6.1, таймаут).
 * - NEW старше N дней → LOST.
 * - CONTACTED без активности (updatedAt) старше 14 дней → LOST.
 */
@Injectable()
export class DealTimeoutService {
  private readonly logger = new Logger(DealTimeoutService.name);
  private readonly newTimeoutDays: number;
  private readonly contactedTimeoutDays = 14;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotificationsService,
    config: ConfigService,
  ) {
    const raw = parseInt(
      config.get<string>('BAZAR_DEAL_TIMEOUT_DAYS') || '7',
      10,
    );
    this.newTimeoutDays = Number.isFinite(raw) && raw > 0 ? raw : 7;
  }

  @Cron('0 3 * * *')
  async closeStaleDeals() {
    let closed = 0;

    closed += await this.closeNewDeals();
    closed += await this.closeContactedDeals();
    closed += await this.closeNegotiatingDeals();

    this.logger.log(`Deal timeout: closed ${closed} stale deals`);
    return { closed };
  }

  private async closeNewDeals(): Promise<number> {
    const cutoff = new Date(Date.now() - this.newTimeoutDays * 24 * 60 * 60 * 1000);
    const deals = await this.prisma.deal.findMany({
      where: { status: DealStatus.NEW, createdAt: { lt: cutoff } },
      select: { id: true, buyerId: true, sellerId: true },
    });

    for (const deal of deals) {
      await this.prisma.deal.update({
        where: { id: deal.id },
        data: { status: DealStatus.LOST },
      });
      await this.pushDealEvent(deal.buyerId, deal.sellerId, deal.id, 'Сделка закрыта автоматически: нет ответа продавца');
    }

    return deals.length;
  }

  private async closeContactedDeals(): Promise<number> {
    const cutoff = new Date(Date.now() - this.contactedTimeoutDays * 24 * 60 * 60 * 1000);
    const deals = await this.prisma.deal.findMany({
      where: { status: DealStatus.CONTACTED, updatedAt: { lt: cutoff } },
      select: { id: true, buyerId: true, sellerId: true },
    });

    for (const deal of deals) {
      await this.prisma.deal.update({
        where: { id: deal.id },
        data: { status: DealStatus.LOST },
      });
      await this.pushDealEvent(deal.buyerId, deal.sellerId, deal.id, 'Сделка закрыта автоматически: нет активности');
    }

    return deals.length;
  }

  /** NEGOTIATING без активности 7 дней → LOST (SPEC §3.3). */
  private async closeNegotiatingDeals(): Promise<number> {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const deals = await this.prisma.deal.findMany({
      where: { status: DealStatus.NEGOTIATING, updatedAt: { lt: cutoff } },
      select: { id: true, buyerId: true, sellerId: true },
    });

    for (const deal of deals) {
      await this.prisma.deal.update({
        where: { id: deal.id },
        data: { status: DealStatus.LOST },
      });
      // Отклоняем все нерешённые офферы.
      await this.prisma.counterOffer.updateMany({
        where: { dealId: deal.id, status: 'PENDING' },
        data: { status: 'REJECTED' },
      });
      await this.pushDealEvent(deal.buyerId, deal.sellerId, deal.id, 'Сделка закрыта автоматически: торг затянулся');
    }

    return deals.length;
  }

  private async pushDealEvent(
    buyerId: string,
    sellerId: string,
    dealId: string,
    content: string,
  ) {
    const heading = 'Сделка закрыта';
    for (const userId of [buyerId, sellerId]) {
      await this.notify.createNotification(userId, 'deal_lost_timeout', content, dealId).catch(() => null);
      try {
        await this.notify.sendToUser(
          userId,
          { en: heading },
          { en: content },
          { screen: 'bazar', dealId },
        );
      } catch (e) {
        this.logger.warn(`Push failed for ${userId}: ${(e as Error).message}`);
      }
    }
  }
}