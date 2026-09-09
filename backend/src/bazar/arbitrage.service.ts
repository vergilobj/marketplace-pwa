import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OrderStatus, DealStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { BazarApiClient } from './bazar.api-client';
import { DealService } from './deal.service';

type Verdict = 'BUYER_RIGHT' | 'SELLER_RIGHT' | 'SPLIT' | 'UNSURE';

interface ParsedVerdict {
  verdict: Verdict;
  confidence: number;
  note: string;
}

const MAX_ATTEMPTS = 3;

/**
 * Фича 5: нейро-арбитраж споров.
 * Cron каждые 10 минут: читает OPEN-споры, LLM-вердикт, исполнение или эскалация.
 */
@Injectable()
export class ArbitrageService {
  private readonly logger = new Logger(ArbitrageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly apiClient: BazarApiClient,
    private readonly deals: DealService,
  ) {}

  @Cron('*/10 * * * *')
  async resolveDisputes() {
    const open = await this.prisma.deal.findMany({
      where: { dispute: 'OPEN' },
    });

    for (const deal of open) {
      const attempts = this.countAttempts(deal.disputeNote);
      if (attempts >= MAX_ATTEMPTS) {
        await this.prisma.deal.update({
          where: { id: deal.id },
          data: { disputeNote: 'NEED_ADMIN' },
        });
        continue;
      }

      try {
        const thread = await this.deals.thread(deal.id, deal.buyerId);
        const text = await this.apiClient.complete(
          [
            {
              role: 'user',
              content: `Ты арбитр. Прочитай переписку сделки и вынеси вердикт строго JSON:
{"verdict":"BUYER_RIGHT"|"SELLER_RIGHT"|"SPLIT"|"UNSURE","confidence":0.0-1.0,"note":"..."}
Сделка: ${JSON.stringify(thread)}`,
            },
          ],
          { sessionKey: `arbitrage_${deal.id}`, temperature: 0 },
        );

        const parsed = this.parseVerdict(text.text);
        if (parsed.confidence >= 0.8 && parsed.verdict !== 'UNSURE') {
          await this.executeVerdict(deal.id, parsed);
        } else {
          // Не уверен — счётчик попыток, потом эскалация админу.
          await this.prisma.deal.update({
            where: { id: deal.id },
            data: { disputeNote: `ATTEMPT_${attempts + 1}` },
          });
        }
      } catch (e) {
        // LLM недоступен — оставляем OPEN, cron ретраит через 10 мин.
        this.logger.warn(`Arbitrage failed for deal ${deal.id}: ${(e as Error).message}`);
      }
    }
  }

  private async executeVerdict(dealId: string, v: ParsedVerdict) {
    const deal = await this.prisma.deal.findUnique({
      where: { id: dealId },
      include: { order: { select: { id: true, status: true } } },
    });
    if (!deal) return;

    if (v.verdict === 'BUYER_RIGHT') {
      if (deal.order && deal.order.status === OrderStatus.PENDING) {
        await this.prisma.order.update({
          where: { id: deal.order.id },
          data: { status: OrderStatus.CANCELLED },
        });
      }
      await this.prisma.deal.update({
        where: { id: dealId },
        data: {
          dispute: 'RESOLVED',
          disputeVerdict: 'BUYER_RIGHT',
          disputeResolvedAt: new Date(),
          disputeNote: v.note,
          status: DealStatus.LOST,
        },
      });
    } else if (v.verdict === 'SELLER_RIGHT') {
      await this.prisma.deal.update({
        where: { id: dealId },
        data: {
          dispute: 'RESOLVED',
          disputeVerdict: 'SELLER_RIGHT',
          disputeResolvedAt: new Date(),
          disputeNote: v.note,
          status: DealStatus.CLOSED,
        },
      });
    } else if (v.verdict === 'SPLIT') {
      if (deal.order) {
        await this.prisma.order.update({
          where: { id: deal.order.id },
          data: { status: OrderStatus.CANCELLED },
        });
      }
      await this.prisma.deal.update({
        where: { id: dealId },
        data: {
          dispute: 'RESOLVED',
          disputeVerdict: 'SPLIT',
          disputeResolvedAt: new Date(),
          disputeNote: `RETURN_50: ${v.note}`,
          status: DealStatus.LOST,
        },
      });
    }
  }

  private parseVerdict(text: string): ParsedVerdict {
    const fenced = text.match(/```(?:json)?\n([\s\S]*?)```/);
    const candidate = fenced ? fenced[1] : text;
    try {
      const start = candidate.indexOf('{');
      const end = candidate.lastIndexOf('}');
      const obj = JSON.parse(candidate.slice(start, end + 1));
      return {
        verdict: obj.verdict ?? 'UNSURE',
        confidence: Number(obj.confidence) || 0,
        note: obj.note ?? '',
      };
    } catch {
      return { verdict: 'UNSURE', confidence: 0, note: '' };
    }
  }

  private countAttempts(note: string | null): number {
    if (!note) return 0;
    const m = note.match(/^ATTEMPT_(\d+)$/);
    return m ? parseInt(m[1], 10) : 0;
  }
}