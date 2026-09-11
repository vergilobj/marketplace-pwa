import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DealStatus, OrderStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';

const BATCH = 500;

/** N9: порог «проверенного продавца» для бейджа в API. */
export const VERIFIED_TRUST_THRESHOLD = 0.75;
export const TRUSTED_TRUST_THRESHOLD = 0.5;

function clamp(low: number, high: number, v: number): number {
  return Math.min(high, Math.max(low, v));
}

/** N9: единственная точка правды «как trustScore превращается в бейдж». */
export function trustBadge(score: number | null | undefined): string {
  const s = typeof score === 'number' ? score : 0.5;
  if (s >= VERIFIED_TRUST_THRESHOLD) return 'VERIFIED_SELLER';
  if (s >= TRUSTED_TRUST_THRESHOLD) return 'TRUSTED';
  return 'NEW';
}

/**
 * Нейро-репутация продавца (SPEC фича 4).
 * trustScore = clamp(0.05, 0.95,
 *   0.40*replySpeed + 0.30*successRate + 0.20*completionRate
 *   - 0.10*cancelRate - 0.10*disputePenalty)
 *
 * N9: метрика не должна быть мёртвой — она отдаётся наружу бейджем
 * (`trustBadge`) через GET /bazar/users/:id/trust и пересчитывается cron'ом.
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

  /**
   * N9 + N16: публичное чтение репутации.
   * Решение: trustScore ПРОДАВЦА — публичная информация (нужна покупателю для
   * выбора), но не произвольного пользователя. Поэтому:
   *   - свой профиль — всегда;
   *   - ADMIN/MODERATOR — всегда;
   *   - чужой — только если у него есть хотя бы один товар (он продавец).
   * Это закрывает enumeration trustScore всех юзеров по id и оставляет
   * публичность там, где она осмысленна.
   */
  async publicTrust(
    targetId: string,
    viewer: { userId: string; role: UserRole },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: {
        id: true,
        name: true,
        trustScore: true,
        trustScoreAt: true,
        products: { select: { id: true }, take: 1 },
      },
    });
    if (!user) throw new NotFoundException('Пользователь не найден');

    const isSelf = targetId === viewer.userId;
    const isStaff =
      viewer.role === UserRole.ADMIN || viewer.role === UserRole.MODERATOR;
    const isPublicSeller = user.products.length > 0;

    if (!isSelf && !isStaff && !isPublicSeller) {
      throw new ForbiddenException(
        'Репутация доступна только для продавцов',
      );
    }

    return {
      id: user.id,
      name: user.name,
      trustScore: user.trustScore,
      trustScoreAt: user.trustScoreAt,
      badge: trustBadge(user.trustScore),
      verified: user.trustScore >= VERIFIED_TRUST_THRESHOLD,
      isSeller: isPublicSeller,
    };
  }

  private async findAllSellers(): Promise<string[]> {
    // Было: products: { some: { id: { not: '' } } } — «id не пустая строка»,
    // всегда true, лишний скан. Достаточно «есть хотя бы один товар».
    const rows = await this.prisma.user.findMany({
      where: { products: { some: {} } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /**
   * Медианное время ответа продавца → 0..1.
   * Продавец считается ответившим по первому сообщению, ретранслированному
   * ИМ (meta.originRole === 'seller'), а не по любому ASSISTANT-сообщению —
   * раньше в выборку попадали сообщения покупателя, адресованные продавцу,
   * и метрика мерила чужую скорость.
   */
  private async computeReplySpeed(sellerId: string): Promise<number> {
    const deals = await this.prisma.deal.findMany({
      where: { sellerId, status: { not: DealStatus.NEW } },
      select: {
        id: true,
        createdAt: true,
        messages: {
          where: { meta: { path: ['originRole'], equals: 'seller' } },
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

  /**
   * LOST / total deals за 90 дней.
   * ВАЖНО: сюда попадают и автозакрытия по таймауту (нет ответа / торг
   * затянулся). Полноценно отделить «отмену по вине продавца» нельзя без
   * поля-маркера в Deal (схема — чужая зона), поэтому вес штрафа оставлен
   * низким (0.10). См. отчёт, п. N9/N5.
   */
  private async computeCancelRate(sellerId: string): Promise<number> {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const total = await this.prisma.deal.count({
      where: { sellerId, createdAt: { gte: cutoff } },
    });
    if (total === 0) return 0;
    const lost = await this.prisma.deal.count({
      where: { sellerId, status: DealStatus.LOST, createdAt: { gte: cutoff } },
    });
    return lost / total;
  }

  /**
   * 0.5 если есть OPEN-спор по живой сделке.
   * N2: теперь dispute='OPEN' реально выставляется (POST /bazar/deals/:id/dispute),
   * поэтому штраф перестал быть теоретическим.
   */
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