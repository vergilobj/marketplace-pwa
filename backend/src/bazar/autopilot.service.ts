import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { BazarRole } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { BazarApiClient } from './bazar.api-client';
import { CatalogSearchService } from './catalog-search.service';
import { DealService } from './deal.service';

const MAX_STEPS = 5;

type Candidate = { id: string; title: string; price: number };

/**
 * Фича 1: автопилот сделки (AutopilotRun + оркестратор шагов).
 * start() → search → LLM-предложение → AWAITING_USER.
 * resume() → confirm (создаём deal детерминированно из сохранённых кандидатов)
 *          или refine (переиск).
 */
@Injectable()
export class AutopilotService {
  private readonly logger = new Logger(AutopilotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly apiClient: BazarApiClient,
    private readonly search: CatalogSearchService,
    private readonly deals: DealService,
  ) {}

  async start(userId: string, goal: string, budget?: number) {
    const active = await this.prisma.autopilotRun.findFirst({
      where: { userId, kind: 'AUTOPILOT', status: { in: ['RUNNING', 'AWAITING_USER'] } },
    });
    if (active) throw new BadRequestException('У вас уже идёт автоподбор');

    const run = await this.prisma.autopilotRun.create({
      data: {
        userId,
        kind: 'AUTOPILOT',
        goal,
        budget: budget ?? null,
        status: 'RUNNING',
        maxSteps: MAX_STEPS,
        step: 1,
      },
    });

    try {
      const catalog = await this.search.search(goal, userId);
      const candidates = this.normalizeCandidates(catalog.products ?? []).slice(0, 3);

      const text = await this.apiClient.complete(
        [
          {
            role: 'user',
            content: `Автопилот. Цель: ${goal}. Бюджет: ${budget ?? 'нет'}. Кандидаты: ${JSON.stringify(candidates)}. Сформулируй предложение и спроси подтверждение. В конце верни \`\`\`action\n{"intent":"none"}\n\`\`\``,
          },
        ],
        { sessionKey: `${userId}_autopilot` },
      );

      await this.writeAssistant(userId, run.id, 1, text.text);
      await this.prisma.autopilotRun.update({
        where: { id: run.id },
        data: { status: 'AWAITING_USER', lastStepAt: new Date(), context: { candidates } as any },
      });

      return { runId: run.id, text: text.text, candidates };
    } catch (e) {
      await this.failRun(run.id, 'Помощник временно недоступен, вот что нашёл — уточните запрос.');
      throw e;
    }
  }

  async resume(
    userId: string,
    event: {
      type: 'confirm' | 'refine';
      accept?: boolean;
      productId?: string;
      feedback?: string;
      text?: string;
    },
  ) {
    const run = await this.activeRun(userId, 'AUTOPILOT');
    if (!run) throw new NotFoundException('Нет активного автоподбора');
    if (run.step >= run.maxSteps) {
      await this.failRun(run.id, 'Не смог подобрать, уточните запрос.');
      throw new BadRequestException('Превышен лимит шагов — начните заново');
    }

    try {
      if (event.type === 'confirm' && event.accept) {
        return this.confirm(userId, run, event);
      }

      // refine / отказ → следующий шаг поиска с учётом feedback И бюджета.
      const feedback = event.type === 'refine' ? event.feedback ?? '' : 'нет, другой вариант';
      const budgetHint = run.budget != null ? ` до ${run.budget} рублей` : '';
      const catalog = await this.search.search(`${run.goal} ${feedback}${budgetHint}`, userId);
      const candidates = this.normalizeCandidates(catalog.products ?? []).slice(0, 3);

      const next = await this.apiClient.complete(
        [
          {
            role: 'user',
            content: `Автопилот. Цель: ${run.goal}. Отзыв пользователя: ${feedback}. Новые кандидаты: ${JSON.stringify(candidates)}. Предложи вариант и спроси подтверждение. В конце верни \`\`\`action\n{"intent":"none"}\n\`\`\``,
          },
        ],
        { sessionKey: `${userId}_autopilot` },
      );

      const newStep = run.step + 1;
      await this.prisma.autopilotRun.update({
        where: { id: run.id },
        data: { step: newStep, lastStepAt: new Date(), status: 'AWAITING_USER', context: { candidates } as any },
      });
      await this.writeAssistant(userId, run.id, newStep, next.text);

      return { step: newStep, text: next.text };
    } catch (e) {
      await this.failRun(run.id, 'Помощник временно недоступен — попробуйте ещё раз.');
      throw e;
    }
  }

  /**
   * Детерминированный confirm: кандидаты берём из run.context, а не ищем заново.
   * Совпадение — по productId из события, затем по цене/названию/номеру в реплике юзера.
   */
  private async confirm(
    userId: string,
    run: any,
    event: { accept?: boolean; productId?: string; text?: string },
  ) {
    let candidates: Candidate[] = (run.context as any)?.candidates ?? [];

    // Edge: кандидаты не сохранились — fallback на поиск по goal, не по тексту confirm.
    if (!candidates.length) {
      const catalog = await this.search.search(run.goal, userId);
      candidates = this.normalizeCandidates(catalog.products ?? []).slice(0, 3);
      if (candidates.length) {
        await this.prisma.autopilotRun.update({
          where: { id: run.id },
          data: { context: { candidates } as any },
        });
      }
    }

    const replyText = event.text ?? (await this.lastUserText(userId));

    // Детерминированно по реплике юзера (приоритетнее, чем productId от LLM,
    // который на confirm мог переискать и прицепить не тот товар).
    let productId: string | undefined = this.matchCandidate(candidates, replyText);

    // productId из события валиден только если он есть в сохранённых кандидатах.
    if (!productId && event.productId) {
      const inCandidates = candidates.some((c) => c.id === event.productId);
      if (inCandidates) productId = event.productId;
    }

    // «беру» без уточнения и ровно один кандидат → берём его.
    if (!productId && candidates.length === 1) {
      productId = candidates[0].id;
    }

    if (productId) {
      const product = await this.prisma.product.findUnique({
        where: { id: productId },
        select: { isActive: true, title: true, price: true },
      });
      if (!product || !product.isActive) {
        await this.writeAssistant(userId, run.id, run.step, 'Товар недоступен — уточните, что ищете.');
        await this.prisma.autopilotRun.update({
          where: { id: run.id },
          data: { status: 'AWAITING_USER' },
        });
        return { done: false, text: 'Товар недоступен' };
      }

      const deal = await this.deals.createFromChat(userId, { productId }, undefined);
      const text = `Готово! Оформляю сделку по «${product.title}» — ${product.price} ₽. Продавцу ушёл лид, ждите ответа.`;
      await this.writeAssistant(userId, run.id, run.step, text);
      await this.prisma.autopilotRun.update({
        where: { id: run.id },
        data: { status: 'DONE', lastStepAt: new Date() },
      });
      return { done: true, text, dealId: deal?.id };
    }

    // Не совпало — перечисляем кандидатов с номерами, ждём уточнения.
    const list = candidates
      .map((c, i) => `${i + 1}. ${c.title} — ${c.price} ₽`)
      .join('\n');
    const text = `Уточните, что берёте:\n${list || '—'}`;
    await this.writeAssistant(userId, run.id, run.step, text);
    await this.prisma.autopilotRun.update({
      where: { id: run.id },
      data: { status: 'AWAITING_USER', lastStepAt: new Date() },
    });
    return { done: false, text };
  }

  /** Сопоставляет реплику юзера с сохранёнными кандидатами: цена → название → порядковый номер. */
  private matchCandidate(candidates: Candidate[], text: string): string | undefined {
    const t = (text || '').trim();
    if (!t || !candidates.length) return undefined;

    // 1) Цена в реплике («за 9695», «9695»).
    const price = this.extractPrice(t);
    if (price != null) {
      const byPrice = candidates.find((c) => Math.abs(c.price - price) < 0.5);
      if (byPrice) return byPrice.id;
    }

    // 2) Порядковый номер («первый», «второй», «третий», «1», «2»).
    const ordinal = this.extractOrdinal(t);
    if (ordinal != null) {
      const idx = ordinal - 1;
      if (idx >= 0 && idx < candidates.length) return candidates[idx].id;
    }

    // 3) Название (подстрока названия товара в реплике).
    const lower = t.toLowerCase();
    const byTitle = candidates.find((c) => {
      const title = (c.title || '').toLowerCase();
      return title && lower.includes(title);
    });
    if (byTitle) return byTitle.id;

    return undefined;
  }

  private extractPrice(text: string): number | null {
    const m = text.toLowerCase().match(/(?:за|по|цена|стоит)?\s*(\d{3,}(?:[.,]\d+)?)\s*(?:₽|руб|р\.?)?/);
    if (!m) return null;
    const raw = parseFloat(m[1].replace(',', '.'));
    return isNaN(raw) ? null : raw;
  }

  private extractOrdinal(text: string): number | null {
    const t = text.toLowerCase();
    const map: Record<string, number> = {
      'перв': 1, 'втор': 2, 'трет': 3, 'четвёрт': 4, 'четверт': 4, 'пят': 5,
    };
    for (const [key, n] of Object.entries(map)) {
      if (t.includes(key)) return n;
    }
    const num = t.match(/(?:^|\s)([1-5])(?:\s|[.,!?.]|$)/);
    if (num) return parseInt(num[1], 10);
    return null;
  }

  private normalizeCandidates(products: any[]): Candidate[] {
    return products
      .filter((p) => p && p.id)
      .map((p) => ({ id: p.id, title: p.title ?? '', price: Number(p.price) || 0 }));
  }

  private async lastUserText(userId: string): Promise<string> {
    const msg = await this.prisma.bazarMessage.findFirst({
      where: { userId, role: BazarRole.USER },
      orderBy: { createdAt: 'desc' },
      select: { text: true },
    });
    return msg?.text ?? '';
  }

  private async activeRun(userId: string, kind: string) {
    return this.prisma.autopilotRun.findFirst({
      where: { userId, kind, status: { in: ['RUNNING', 'AWAITING_USER'] } },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async failRun(runId: string, message: string) {
    await this.prisma.autopilotRun.update({
      where: { id: runId },
      data: { status: 'FAILED', error: message, lastStepAt: new Date() },
    });
  }

  private async writeAssistant(userId: string, runId: string, step: number, text: string) {
    await this.prisma.bazarMessage.create({
      data: {
        userId,
        role: BazarRole.ASSISTANT,
        text,
        meta: { agentRunId: runId, step, originRole: 'assistant' },
      },
    });
  }
}