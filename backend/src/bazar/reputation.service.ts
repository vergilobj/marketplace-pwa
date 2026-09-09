import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DealStatus, OrderStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';

const BATCH = 500;

function clamp(low: number, high: number, v: number): number {
  return Math.min(high, Math.max(low, v));
}

/**
 * Нейро-репутация продавца (SPEC фича 4).
 * trustScore = clamp(0.05, 0.95,
 *   0.40*replySpeed + 0.30*successRate + 0.20*completionRate
 *   - 0.10*cancelRate - 0.10*disputePenalty)
 */
@Injectable()
export class ReputationService {
  private readonly logger = new Logger(ReputationService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('0 4 * * *')
  async recomputeAll() {
    const sellerIds = await this.findAllSellers();
    let updated = 0;
    for (let i = 0; i < sellerIds.length; i += BATCH) {
      const batch = sellerIds.slice(i, i + BATCH);
      for (const sellerId of batch) {
        try {
          await this.recompute(sellerId);
          updated++;
        } catch (e) {
          this.logger.warn(`recompute failed for ${sellerId}: ${(e as Error).message}`);
        }
      }
    }
    this.logger.log(`Reputation recompute done: ${updated} sellers`);
    return { updated };
  }

  /** Полный пересчёт одного продавца. Возвращает вычисленный скор. */
  async recompute(sellerId: string): Promise<number> {
    const [replySpeed, successRate, completionRate, cancelRate, disputePenalty] =
      await Promise.all([
        this.computeReplySpeed(sellerId),
        this.computeSuccessRate(sellerId),
        this.computeCompletionRate(sellerId),
        this.computeCancelRate(sellerId),
        this.computeDisputePenalty(sellerId),
      ]);

    const raw =
      0.40 * replySpeed +
      0.30 * successRate +
      0.20 * completionRate -
      0.10 * cancelRate -
      0.10 * disputePenalty;

    const trustScore = Math.round(clamp(0.05, 0.95, raw) * 1000) / 1000;

    await this.prisma.user.update({
      where: { id: sellerId },
      data: { trustScore, trustScoreAt: new Date() },
    });

    return trustScore;
  }

  private async findAllSellers(): Promise<string[]> {
    const rows = await this.prisma.user.findMany({
      where: { products: { some: { id: { not: '' } } } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** Медианное время ответа продавца → 0..1. */
  private async computeReplySpeed(sellerId: string): Promise<number> {
    const deals = await this.prisma.deal.findMany({
      where: { sellerId, status: { not: DealStatus.NEW } },
      select: {
        id: true,
        createdAt: true,
        messages: {
          where: { userId: sellerId, role: 'ASSISTANT' },
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { createdAt: true },
        },
      },
      take: 50,
    });

    const diffsMs: number[] = [];
    for (const d of deals) {
      const firstReply = d.messages[0];
      if (!firstReply) continue;
      const diff = firstReply.createdAt.getTime() - d.createdAt.getTime();
      if (diff >= 0) diffsMs.push(diff);
    }
    if (diffsMs.length === 0) return 0.5;

    diffsMs.sort((a, b) => a - b);
    const median = diffsMs[Math.floor(diffsMs.length / 2)];
    const hours = median / 3_600_000;

    if (hours < 1) return 1.0;
    if (hours < 6) return 0.7;
    if (hours < 24) return 0.4;
    return 0.1;
  }

  /** CLOSED / (CLOSED + LOST) за 90 дней, min 3 сделки иначе 0.5. */
  private async computeSuccessRate(sellerId: string): Promise<number> {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const [closed, lost] = await Promise.all([
      this.prisma.deal.count({
        where: { sellerId, status: DealStatus.CLOSED, createdAt: { gte: cutoff } },
      }),
      this.prisma.deal.count({
        where: { sellerId, status: DealStatus.LOST, createdAt: { gte: cutoff } },
      }),
    ]);
    const total = closed + lost;
    if (total < 3) return 0.5;
    return closed / total;
  }

  /** Order COMPLETED / total seller orders, min 1 иначе 0.5. */
  private async computeCompletionRate(sellerId: string): Promise<number> {
    const [completed, total] = await Promise.all([
      this.prisma.order.count({ where: { sellerId, status: OrderStatus.COMPLETED } }),
      this.prisma.order.count({ where: { sellerId } }),
    ]);
    if (total === 0) return 0.5;
    return completed / total;
  }

  /** LOST где инициатор продавец / total deals за 90 дней. */
  private async computeCancelRate(sellerId: string): Promise<number> {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const total = await this.prisma.deal.count({
      where: { sellerId, createdAt: { gte: cutoff } },
    });
    if (total === 0) return 0;
    // Инициатор = продавец, если последнее сообщение-ретрансляция пришло от seller
    // (упрощение: считаем LOST-сделки как потенциальные отмены, доля)
    const lost = await this.prisma.deal.count({
      where: { sellerId, status: DealStatus.LOST, createdAt: { gte: cutoff } },
    });
    return lost / total;
  }

  /** 0.5 если есть OPEN dispute в активных сделках. */
  private async computeDisputePenalty(sellerId: string): Promise<number> {
    const open = await this.prisma.deal.count({
      where: {
        sellerId,
        dispute: 'OPEN',
        status: { notIn: [DealStatus.CLOSED, DealStatus.LOST] },
      },
    });
    return open > 0 ? 0.5 : 0;
  }
}