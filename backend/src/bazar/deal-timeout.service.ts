import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { DealStatus, OrderStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DealService } from './deal.service';

/**
 * Автозакрытие зависших сделок (SPEC §6.1, таймаут).
 * - NEW старше N дней → LOST.
 * - CONTACTED без активности (updatedAt) старше 14 дней → LOST.
 * - NEGOTIATING без активности 7 дней → LOST.
 * - N7: ACCEPTED без оплаты старше N часов → LOST (+ отмена PENDING-заказа).
 * - N1: ACCEPTED, чей заказ уже COMPLETED → CLOSED (успешный финал).
 */
@Injectable()
export class DealTimeoutService {
  private readonly logger = new Logger(DealTimeoutService.name);
  private readonly newTimeoutDays: number;
  private readonly contactedTimeoutDays = 14;
  /** N7: таймаут неоплаченной принятой сделки. */
  private readonly acceptedUnpaidTimeoutHours: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotificationsService,
    private readonly deals: DealService,
    config: ConfigService,
  ) {
    const raw = parseInt(
      config.get<string>('BAZAR_DEAL_TIMEOUT_DAYS') || '7',
      10,
    );
    this.newTimeoutDays = Number.isFinite(raw) && raw > 0 ? raw : 7;

    const rawHours = parseInt(
      config.get<string>('BAZAR_ACCEPTED_TIMEOUT_HOURS') || '24',
      10,
    );
    this.acceptedUnpaidTimeoutHours =
      Number.isFinite(rawHours) && rawHours > 0 ? rawHours : 24;
  }

  @Cron('0 3 * * *')
  async closeStaleDeals() {
    let closed = 0;
    let completed = 0;

    // N1: сначала финализируем успешные сделки — заказ выполнен → CLOSED.
    // Делаем это ДО таймаутов, чтобы завершённая сделка не ушла в LOST.
    try {
      completed = await this.deals.closeDealsForCompletedOrders();
    } catch (e) {
      this.logger.warn(
        `closeDealsForCompletedOrders failed: ${(e as Error).message}`,
      );
    }

    closed += await this.closeNewDeals();
    closed += await this.closeContactedDeals();
    closed += await this.closeNegotiatingDeals();
    closed += await this.closeAcceptedUnpaidDeals();

    this.logger.log(
      `Deal timeout: closed ${closed} stale deals, finalized ${completed} completed`,
    );
    return { closed, completed };
  }

  private async closeNewDeals(): Promise<number> {
    const cutoff = new Date(
      Date.now() - this.newTimeoutDays * 24 * 60 * 60 * 1000,
    );
    const deals = await this.prisma.deal.findMany({
      where: { status: DealStatus.NEW, createdAt: { lt: cutoff } },
      select: { id: true, buyerId: true, sellerId: true },
    });

    for (const deal of deals) {
      await this.prisma.deal.update({
        where: { id: deal.id },
        data: { status: DealStatus.LOST },
      });
      await this.pushDealEvent(
        deal.buyerId,
        deal.sellerId,
        deal.id,
        'Сделка закрыта автоматически: нет ответа продавца',
      );
    }

    return deals.length;
  }

  private async closeContactedDeals(): Promise<number> {
    const cutoff = new Date(
      Date.now() - this.contactedTimeoutDays * 24 * 60 * 60 * 1000,
    );
    const deals = await this.prisma.deal.findMany({
      where: { status: DealStatus.CONTACTED, updatedAt: { lt: cutoff } },
      select: { id: true, buyerId: true, sellerId: true },
    });

    for (const deal of deals) {
      await this.prisma.deal.update({
        where: { id: deal.id },
        data: { status: DealStatus.LOST },
      });
      await this.pushDealEvent(
        deal.buyerId,
        deal.sellerId,
        deal.id,
        'Сделка закрыта автоматически: нет активности',
      );
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
      await this.pushDealEvent(
        deal.buyerId,
        deal.sellerId,
        deal.id,
        'Сделка закрыта автоматически: торг затянулся',
      );
    }

    return deals.length;
  }

  /**
   * N7: принятая, но неоплаченная сделка.
   * Таймаут по умолчанию 24ч (BAZAR_ACCEPTED_TIMEOUT_HOURS).
   * - Order отсутствует или PENDING и старше таймаута → deal LOST,
   *   PENDING-заказ → CANCELLED (денег ещё нет, отмена безопасна).
   * - Order в PAID/SHIPPED — НЕ трогаем: там уже деньги/логистика,
   *   это зона payments, а не таймаута.
   */
  private async closeAcceptedUnpaidDeals(): Promise<number> {
    const cutoff = new Date(
      Date.now() - this.acceptedUnpaidTimeoutHours * 60 * 60 * 1000,
    );
    const deals = await this.prisma.deal.findMany({
      where: {
        status: DealStatus.ACCEPTED,
        updatedAt: { lt: cutoff },
      },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        orderId: true,
        order: { select: { id: true, status: true } },
      },
    });

    let closed = 0;
    for (const deal of deals) {
      const orderStatus = deal.order?.status;
      const isUnpaid =
        !deal.order ||
        orderStatus === OrderStatus.PENDING ||
        orderStatus === OrderStatus.CANCELLED;
      if (!isUnpaid) continue;

      await this.prisma.deal.update({
        where: { id: deal.id },
        data: { status: DealStatus.LOST },
      });
      // Отменяем только неоплаченный заказ, чтобы не оставлять «висяк».
      if (deal.order && orderStatus === OrderStatus.PENDING) {
        await this.prisma.order
          .update({
            where: { id: deal.order.id },
            data: { status: OrderStatus.CANCELLED },
          })
          .catch((e) =>
            this.logger.warn(
              `Order cancel failed ${deal.order?.id}: ${(e as Error).message}`,
            ),
          );
      }
      await this.pushDealEvent(
        deal.buyerId,
        deal.sellerId,
        deal.id,
        'Сделка закрыта автоматически: оплата не поступила',
      );
      closed++;
    }

    return closed;
  }

  private async pushDealEvent(
    buyerId: string,
    sellerId: string,
    dealId: string,
    content: string,
  ) {
    const heading = 'Сделка закрыта';
    for (const userId of [buyerId, sellerId]) {
      await this.notify
        .createNotification(userId, 'deal_lost_timeout', content, dealId)
        .catch(() => null);
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
