import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OrderStatus, DealStatus, EscrowStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { EscrowService } from '../payments/escrow.service';
import { AlertsService } from '../common/alerts/alerts.service';
import { BazarApiClient } from './bazar.api-client';
import { DealService } from './deal.service';
// NH8: маркер позиции покупателя (пишется orders API в Order.cancelReason).
// Импорт чистого модуля-константы, DI-граф не затрагивается.
import { ORDER_DECISION_MARKER } from '../marketplace/orders.service';

type Verdict = 'BUYER_RIGHT' | 'SELLER_RIGHT' | 'SPLIT' | 'UNSURE';

interface ParsedVerdict {
  verdict: Verdict;
  confidence: number;
  note: string;
}

const MAX_ATTEMPTS = 3;

/**
 * NH8: спор по заказу БЕЗ Deal.
 *
 * Deal-путь (`Deal.dispute = 'OPEN'`) остаётся основным для сделок базара.
 * Но заказ маркетплейса создаётся БЕЗ dealId (`OrdersService.create`), поэтому
 * спор по нему до арбитража не доходил: Deal нет → `Deal.dispute` не
 * выставляется → `resolveDisputes` (фильтр по Deal) его не видит,
 * `autoCloseOrders` фильтрует PAID/SHIPPED, матрица DISPUTED пуста. Решение
 * можно было получить только руками через `adminForceStatus`.
 *
 * Теперь арбитраж читает `Order.status = 'DISPUTED'` напрямую (вариант A) —
 * фильтр `deals: { none: {} }` отсекает заказы, у которых сделка есть, чтобы
 * не арбитрировать один спор дважды (deal-путь + order-путь).
 *
 * Прогресс попыток и эскалация хранятся в `Order.cancelReason`: новых полей
 * в схеме не заводим (schema.prisma делят несколько билдеров), а у заказа в
 * DISPUTED это поле свободно. Форматы: `ARB_RETRY:<n>`, `ARB_ESCALATED`.
 * Готовый вердикт пишется туда же как `VERDICT:{...}` — тот же контракт, что
 * у `Deal.disputeNote` (его читает payments), плюс `Order.disputeResolvedAt`.
 */
export const ORDER_RETRY_MARKER = 'ARB_RETRY:';
export const ORDER_ESCALATED_MARKER = 'ARB_ESCALATED';

/**
 * N5: арбитраж НЕ двигает деньги сам (это зона payments, другой билдер).
 * Он лишь пишет ДЕКЛАРАТИВНОЕ решение, которое payments читает:
 *   disputeVerdict  — BUYER_RIGHT | SELLER_RIGHT | SPLIT
 *   disputeSplitPct — доля возврата покупателю, % (BUYER_RIGHT=100, SPLIT=50, SELLER_RIGHT=0)
 *   disputeRefundAmount — абсолютная сумма возврата, USDT
 *   disputeResolvedAt / dispute = RESOLVED — сигнал «вердикт готов, исполняй»
 * Контракт для payments: взять Deal с dispute='RESOLVED' AND disputeRefundAmount>0
 * AND (order.status='PAID') → сделать возврат, затем выставить paymentSettledAt.
 */
type VerdictDecision = {
  splitPct: number;
  refundAmount: number;
};

/** N5: префикс машиночитаемого вердикта в disputeNote (без миграции схемы). */
export const VERDICT_MARKER = 'VERDICT:';

export interface DisputeDecision {
  verdict: Verdict;
  splitPct: number;
  refundAmount: number;
  note: string;
  resolvedAt?: string;
}

/**
 * N5: контракт для payments. Парсит решение арбитра из `Deal.disputeNote`.
 * Вынесено из сервиса, чтобы payments (чужой модуль) мог импортировать
 * чистую функцию, не тянув NestJS-провайдер.
 */
export function parseDisputeDecision(
  disputeNote: string | null | undefined,
): DisputeDecision | null {
  if (!disputeNote || !disputeNote.startsWith(VERDICT_MARKER)) return null;
  try {
    const obj = JSON.parse(disputeNote.slice(VERDICT_MARKER.length));
    return {
      verdict: obj.verdict,
      splitPct: Number(obj.splitPct) || 0,
      refundAmount: Number(obj.refundAmount) || 0,
      note: obj.note ?? '',
      resolvedAt: obj.resolvedAt,
    };
  } catch {
    return null;
  }
}

/**
 * Фича 5: нейро-арбитраж споров.
 * Cron каждые 10 минут: читает OPEN-споры, LLM-вердикт, исполнение или эскалация.
 * N2: dispute='OPEN' теперь выставляется через POST /bazar/deals/:id/dispute.
 */
@Injectable()
export class ArbitrageService {
  private readonly logger = new Logger(ArbitrageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly apiClient: BazarApiClient,
    private readonly deals: DealService,
    private readonly escrow: EscrowService,
    // G2: внешний канал алертов. @Optional — спеки конструируют сервис
    // руками (new ArbitrageService(prisma, api, deals, escrow)).
    @Optional() private readonly alerts?: AlertsService,
  ) {}

  @Cron('*/10 * * * *')
  async resolveDisputes() {
    const open = await this.prisma.deal.findMany({
      where: { dispute: 'OPEN' },
    });

    for (const deal of open) {
      const attempts = this.countAttempts(deal.disputeNote);
      // NH6: NEED_ADMIN — эскалация уже случилась, повторно не арбитрируем.
      // Без этого дело с пометкой NEED_ADMIN каждый тик заново уходило в LLM
      // (countAttempts не распознаёт маркер) и снова пыталось двигать эскроу.
      if (deal.disputeNote === 'NEED_ADMIN' || attempts >= MAX_ATTEMPTS) {
        if (deal.disputeNote !== 'NEED_ADMIN') {
          await this.prisma.deal.update({
            where: { id: deal.id },
            data: { disputeNote: 'NEED_ADMIN' },
          });
        }
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
        this.logger.warn(
          `Arbitrage failed for deal ${deal.id}: ${(e as Error).message}`,
        );
      }
    }

    // NH8: вторая очередь — споры по заказам БЕЗ сделки. Падение этой ветки
    // не должно ломать основной (deal) проход, поэтому обёрнуто.
    try {
      await this.resolveOrderDisputes();
    } catch (e) {
      this.logger.warn(
        `NH8: очередь споров по заказам без Deal упала: ${(e as Error).message}`,
      );
    }
  }

  /**
   * NH8 (вариант A): очередь споров по заказам маркетплейса без Deal.
   *
   * Берём `Order.status = 'DISPUTED'` + `escrowStatus = HELD` — это ровно те
   * заказы, которые «зависли»: таймер снят (autoCompleteAt = null), Deal нет,
   * значит ни арбитраж, ни авто-закрытие их не трогали.
   *
   * Заказы с существующей сделкой исключены (`deals: { none: {} }`) — их ведёт
   * основной проход по `Deal.dispute = 'OPEN'`, дублировать арбитраж нельзя.
   */
  private async resolveOrderDisputes(): Promise<void> {
    const disputed = await this.prisma.order.findMany({
      where: {
        status: OrderStatus.DISPUTED,
        escrowStatus: EscrowStatus.HELD,
        deals: { none: {} },
      },
      select: { id: true, cancelReason: true },
      take: 50,
    });

    for (const o of disputed) {
      // Отсев эскалированных — В JS, а не в SQL: `NOT: { cancelReason: {
      // startsWith: ... } }` в Prisma вырождается в `NOT (col LIKE '...')`,
      // а для NULL это NULL → строка не проходит фильтр. Так отсеивались ВСЕ
      // свежие споры (у них cancelReason = null), и заказ без Deal снова
      // оставался без арбитража. Поймано ad-hoc e2e-проверкой.
      if (o.cancelReason === ORDER_ESCALATED_MARKER) continue;

      const attempts = this.countOrderAttempts(o.cancelReason);
      if (attempts >= MAX_ATTEMPTS) {
        await this.escalateOrder(o.id);
        continue;
      }
      try {
        await this.processOrderDispute(o.id, attempts);
      } catch (e) {
        // LLM/escrow недоступны — заказ остаётся DISPUTED + HELD, cron повторит.
        this.logger.warn(
          `Arbitrage (order) failed for ${o.id}: ${(e as Error).message}`,
        );
      }
    }
  }

  /**
   * NH8: один спор по заказу без Deal — контекст, вердикт, исполнение.
   *
   * Контекст для арбитра собирается по данным заказа (эскроу, стороны, товар),
   * а если у заказа всё-таки есть чат сделки — он добавляется.
   */
  private async processOrderDispute(
    orderId: string,
    attempt: number,
  ): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        product: { select: { id: true, title: true, description: true } },
        deals: { select: { id: true } },
      },
    });
    if (!order) return;
    // Пока cron думал, заказ мог закрыться/оплатиться — работаем только со
    // спором в HELD и без сделки (иначе это дело deal-пути).
    if (order.status !== OrderStatus.DISPUTED) return;
    if (order.escrowStatus !== EscrowStatus.HELD) return;
    if (order.deals.length > 0) return;

    const context = this.buildOrderDisputeContext(order);
    const text = await this.apiClient.complete(
      [
        {
          role: 'user',
          content: `Ты арбитр. Прочитай материалы спора по заказу маркетплейса и вынеси вердикт строго JSON:
{"verdict":"BUYER_RIGHT"|"SELLER_RIGHT"|"SPLIT"|"UNSURE","confidence":0.0-1.0,"note":"..."}
Заказ: ${context}`,
        },
      ],
      { sessionKey: `arbitrage_order_${orderId}`, temperature: 0 },
    );

    const parsed = this.parseVerdict(text.text);
    if (parsed.confidence >= 0.8 && parsed.verdict !== 'UNSURE') {
      await this.executeOrderVerdict(order, parsed);
      return;
    }

    // Не уверен — счётчик попыток в cancelReason, после MAX_ATTEMPTS эскалация.
    await this.prisma.order.update({
      where: { id: orderId },
      data: { cancelReason: `${ORDER_RETRY_MARKER}${attempt + 1}` },
    });
  }

  /** NH8: материалы спора по заказу для LLM (без чата сделки — его нет). */
  private buildOrderDisputeContext(order: {
    id: string;
    amount: number;
    status: OrderStatus;
    escrowStatus: EscrowStatus;
    escrowAmount: number;
    paidAt?: Date | null;
    createdAt?: Date;
    buyerId: string;
    sellerId: string;
    cancelReason?: string | null;
    product?: { title: string; description: string | null } | null;
  }): string {
    const parts = [
      `Заказ ${order.id} (маркетплейс, без сделки в базаре).`,
      `Статус: ${order.status}, эскроу: ${order.escrowStatus} ${order.escrowAmount} USDT.`,
      `Сумма заказа: ${order.amount} USDT.`,
      `Покупатель: ${order.buyerId}, продавец: ${order.sellerId}.`,
    ];
    if (order.product) {
      parts.push(
        `Товар: ${order.product.title}. ${order.product.description ?? ''}`.trim(),
      );
    }
    if (order.paidAt) parts.push(`Оплачен: ${order.paidAt.toISOString()}`);
    // NH8: позиция покупателя, если он её заявил при открытии спора
    // («требую возврат» + комментарий). Без неё у арбитра нет ни чата, ни
    // претензии — только сухие данные заказа.
    if (order.cancelReason?.startsWith(ORDER_DECISION_MARKER)) {
      parts.push(
        `Требование покупателя (USER_DECISION): ${order.cancelReason.slice(ORDER_DECISION_MARKER.length)}`,
      );
    }
    return parts.join('\n');
  }

  /**
   * NH8: исполнение вердикта по заказу без Deal.
   *
   * Порядок тот же, что в deal-пути (NH6): сначала деньги, потом фиксация
   * вердикта. Ошибка settle пробрасывается — заказ остаётся DISPUTED + HELD,
   * cron повторит через 10 минут.
   *
   * Вердикт фиксируется в `cancelReason` = VERDICT:{...} — тот же JSON-контракт,
   * что payments читает из Deal.disputeNote (parseDisputeDecision); `resolvedAt`
   * внутри JSON служит отметкой времени. Схему не трогаем: `Order.disputeResolvedAt`
   * не существует (поле есть только у Deal), новых полей не заводим.
   */
  private async executeOrderVerdict(
    order: {
      id: string;
      amount: number;
      status: OrderStatus;
      escrowStatus: EscrowStatus;
      buyerId: string;
      sellerId: string;
    },
    v: ParsedVerdict,
  ): Promise<void> {
    const decision = this.computeDecision(v.verdict, {
      order: { amount: order.amount },
    });
    const resolvedAt = new Date();

    const disputeNote =
      VERDICT_MARKER +
      JSON.stringify({
        verdict: v.verdict,
        splitPct: decision.splitPct,
        refundAmount: decision.refundAmount,
        note: v.note,
        orderId: order.id,
        orderStatus: order.status,
        source: 'order_no_deal',
        resolvedAt: resolvedAt.toISOString(),
      });

    await this.settleEscrow(order.id, order, v.verdict, decision.splitPct);

    await this.prisma.order.update({
      where: { id: order.id },
      data: { cancelReason: disputeNote },
    });

    this.logger.log(
      `Arbitrage resolved order ${order.id} (no deal): ${v.verdict} (refund=${decision.refundAmount}, split=${decision.splitPct}%)`,
    );
  }

  /** NH8: MAX_ATTEMPTS исчерпан — помечаем заказ для ручного разбора админом. */
  private async escalateOrder(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { cancelReason: true },
    });
    if (!order || order.cancelReason === ORDER_ESCALATED_MARKER) return;

    await this.prisma.order.update({
      where: { id: orderId },
      data: { cancelReason: ORDER_ESCALATED_MARKER },
    });
    this.logger.warn(
      `ALERT arbitration escalated to admin: order ${orderId} (no deal, ${MAX_ATTEMPTS} attempts)`,
    );
    // G2: эскалация без сделки = арбитраж не смог разобрать спор сам.
    await this.alerts?.send({
      code: 'arbitration_escalated',
      severity: 'error',
      message:
        `Арбитраж эскалирован админу: заказ ${orderId} ` +
        `(нет сделки, ${MAX_ATTEMPTS} попыток)`,
      context: { orderId, attempts: MAX_ATTEMPTS },
    });
  }

  /**
   * Исполнение вердикта.
   * Разделение зон:
   *   - статусы Deal ставит арбитраж (CLOSED — продавец прав, LOST — покупатель/сплит);
   *   - заказ в PENDING можно безопасно отменить (денег ещё нет);
   *   - заказ в PAID/SHIPPED НЕ отменяется — возврат денег делает payments
   *     по полю disputeRefundAmount (N5).
   */
  private async executeVerdict(dealId: string, v: ParsedVerdict) {
    const deal = await this.prisma.deal.findUnique({
      where: { id: dealId },
      include: {
        order: {
          select: { id: true, status: true, amount: true, escrowStatus: true },
        },
      },
    });
    if (!deal) return;

    const decision: VerdictDecision = this.computeDecision(v.verdict, deal);
    const resolvedAt = new Date();

    // Предоплатный заказ (PENDING) отменяем сами — возвращать нечего.
    if (
      deal.order &&
      deal.order.status === OrderStatus.PENDING &&
      (v.verdict === 'BUYER_RIGHT' || v.verdict === 'SPLIT')
    ) {
      await this.prisma.order.update({
        where: { id: deal.order.id },
        data: { status: OrderStatus.CANCELLED },
      });
    }

    // N5: решение для payments пишем машиночитаемо в disputeNote —
    // новых полей в схеме не заводим (schema.prisma делят несколько билдеров).
    const disputeNote =
      VERDICT_MARKER +
      JSON.stringify({
        verdict: v.verdict,
        splitPct: decision.splitPct,
        refundAmount: decision.refundAmount,
        note: v.note,
        orderId: deal.order?.id ?? null,
        orderStatus: deal.order?.status ?? null,
        resolvedAt: resolvedAt.toISOString(),
      });

    // §5.3 / NH6: порядок «деньги → вердикт».
    // Раньше сначала писался dispute='RESOLVED' (арбитраж считает дело
    // закрытым и больше его не возьмёт), и только потом двигался эскроу.
    // Падение release/refund в этот момент запирало Order в DISPUTED + HELD
    // навсегда: autoCloseOrders фильтрует PAID/SHIPPED, матрица DISPUTED
    // пуста, adminForceStatus из DISPUTED+HELD отказывает — деньги заморожены
    // без пути возврата. Теперь сначала двигаем деньги (escrow-методы
    // идемпотентны по escrowStatus и refKey), и только при успехе фиксируем
    // вердикт. Ошибка пробрасывается наверх: Deal остаётся OPEN, cron
    // повторит через 10 минут.
    await this.settleEscrow(deal.id, deal.order, v.verdict, decision.splitPct);

    await this.prisma.deal.update({
      where: { id: dealId },
      data: {
        dispute: 'RESOLVED',
        disputeVerdict: v.verdict,
        disputeResolvedAt: resolvedAt,
        disputeNote,
        status:
          v.verdict === 'SELLER_RIGHT' ? DealStatus.CLOSED : DealStatus.LOST,
      },
    });

    this.logger.log(
      `Arbitrage resolved ${dealId}: ${v.verdict} (refund=${decision.refundAmount}, split=${decision.splitPct}%)`,
    );
  }

  /**
   * Исполнение денежной части вердикта (§5.3).
   *
   *   BUYER_RIGHT  → refundEscrow(100%) — Order REFUNDED, эскроу покупателю;
   *   SELLER_RIGHT → releaseEscrow       — Order COMPLETED, эскроу продавцу;
   *   SPLIT        → refundEscrow(pct)   — распределение по долям.
   *
   * NH10: `refundEscrow` теперь ad-aware. Если заказ рекламный, деньги
   * распределяются по фактически показанным дням, а объявление гасится в той
   * же транзакции — иначе вердикт BUYER_RIGHT возвращал рекламодателю 100%,
   * оставляя объявление в ленте бесплатно (дыра NH10). Дополнительно спор на
   * рекламном заказе не открывается вовсе (вариант B в OrdersService).
   *
   * Если эскроу не в HELD (PENDING-заказ / уже закрыт) — ничего не делаем:
   * деньги двигать нечего.
   */
  private async settleEscrow(
    dealId: string,
    order: { id: string; escrowStatus?: EscrowStatus } | null,
    verdict: Verdict,
    splitPct: number,
  ): Promise<void> {
    if (!order || order.escrowStatus !== EscrowStatus.HELD) return;

    // NH6: ошибку НЕ глотаем.
    // Раньше здесь стоял catch { logger.error } — при падении release/refund
    // вердикт уже был помечен RESOLVED, Order оставался DISPUTED+HELD, и
    // эскроу висел вечно (autoCloseOrders/матрица его не видят, а арбитраж
    // дело больше не берёт). Теперь ошибка уходит наверх: вердикт не
    // фиксируется, Deal остаётся OPEN и cron повторяет попытку.
    try {
      if (verdict === 'SELLER_RIGHT') {
        await this.escrow.releaseEscrow(order.id, 'arbitration');
      } else if (verdict === 'BUYER_RIGHT') {
        await this.escrow.refundEscrow(
          order.id,
          'arbitration_buyer_right',
          100,
        );
      } else if (verdict === 'SPLIT') {
        await this.escrow.refundEscrow(
          order.id,
          'arbitration_split',
          splitPct > 0 ? splitPct : 50,
        );
      }
    } catch (e) {
      const message = (e as Error).message;
      // NH6: НЕ глотаем и НЕ помечаем дело закрытым. Ошибку пробрасываем —
      // resolveDisputes оставит Deal в статусе OPEN (вердикт не зафиксирован),
      // cron повторит попытку через 10 минут, пока settle не пройдёт. Раньше
      // здесь был только logger.error, а Deal уже стоял RESOLVED — эскроу
      // запирался навсегда. Для ручного разбора у админа остаётся
      // adminForceStatus REFUNDED/COMPLETED (escrow-методы работают из
      // DISPUTED+HELD).
      this.logger.error(
        `ALERT arbitration escrow settlement failed for order ${order.id} (deal ${dealId}): ${message}`,
      );
      // G2: расчёт эскроу по вердикту не прошёл, Deal остаётся OPEN и cron
      // повторит через 10 минут — но если сторона недоступна, спор зависнет
      // навсегда. Дедуп в AlertsService не даст спамить каждые 10 минут.
      await this.alerts?.send({
        code: 'arbitration_escrow_settlement_failed',
        severity: 'error',
        message:
          `Арбитраж: расчёт эскроу не прошёл для заказа ${order.id} ` +
          `(сделка ${dealId}): ${message}`,
        context: { orderId: order.id, dealId },
      });
      throw e;
    }
  }

  /**
   * N5: чистая функция «вердикт → денежное решение».
   * Вынесена отдельно, чтобы payments и тесты опирались на один расчёт.
   */
  computeDecision(
    verdict: Verdict,
    deal: { order?: { amount: number } | null; cashPrice?: number | null },
  ): VerdictDecision {
    const amount = deal.order?.amount ?? deal.cashPrice ?? 0;
    switch (verdict) {
      case 'BUYER_RIGHT':
        return { splitPct: 100, refundAmount: round2(amount) };
      case 'SPLIT':
        return { splitPct: 50, refundAmount: round2(amount * 0.5) };
      case 'SELLER_RIGHT':
      default:
        return { splitPct: 0, refundAmount: 0 };
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

  /** NH8: счётчик попыток арбитража по заказу (cancelReason = ARB_RETRY:n). */
  private countOrderAttempts(marker: string | null): number {
    if (!marker) return 0;
    const m = marker.match(/^ARB_RETRY:(\d+)$/);
    return m ? parseInt(m[1], 10) : 0;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
