import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import {
  Prisma,
  DealStatus,
  DealSource,
  BazarRole,
  OrderStatus,
  PriceSource,
  EscrowStatus,
} from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { ModerationService } from '../moderation/moderation.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { EscrowService } from '../payments/escrow.service';
import { computeFees, round2 } from '../payments/money.util';

const MAX_RELAY_TEXT = 4000;

/**
 * Детерминированный lifecycle сделок (SPEC §6.1).
 * Ретрансляция — ДОСЛОВНАЯ, LLM не участвует.
 */
@Injectable()
export class DealService {
  private readonly logger = new Logger(DealService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly moderation: ModerationService,
    private readonly notify: NotificationsService,
    private readonly settings: SettingsService,
    private readonly escrow: EscrowService,
  ) {}

  /** Создание сделки из чата с Базаром. Без LLM. */
  async createFromChat(
    buyerId: string,
    p: { productId?: string; sellerId?: string },
    originMsg?: { id: string; text?: string | null },
  ) {
    let productId = p.productId;
    let sellerId = p.sellerId;

    if (productId && !sellerId) {
      const prod = await this.prisma.product.findUnique({
        where: { id: productId },
      });
      sellerId = prod?.sellerId;
    }
    if (!sellerId) throw new BadRequestException('Не удалось определить продавца');
    if (buyerId === sellerId) throw new BadRequestException('Нельзя создать сделку с самим собой');

    // Модерация текста первого сообщения, если он есть.
    if (originMsg?.text) {
      const v = await this.moderation.moderate({
        text: originMsg.text,
        entityType: 'deal_message',
        entityId: undefined,
        userId: buyerId,
      });
      if (v.verdict === 'block') {
        throw new BadRequestException('Не могу создать сделку: ' + v.reason);
      }
    }

    const deal = await this.prisma.deal.create({
      data: {
        buyerId,
        sellerId,
        productId,
        source: DealSource.BAZAR_CHAT,
        status: DealStatus.NEW,
        originMsgId: originMsg?.id,
      },
      include: { product: { select: { id: true, title: true, price: true } } },
    });

    await this.writeAssistantMsg(sellerId, {
      text: 'Новый лид по вашему товару. Ответьте, чтобы начать диалог.',
      dealId: deal.id,
      meta: {
        relay: false,
        dealId: deal.id,
        action: { intent: 'create_deal', payload: { dealId: deal.id } },
      },
    });

    await this.pushDealEvent(
      sellerId,
      'Новый лид',
      deal.product?.title
        ? `Покупатель интересуется: ${deal.product.title}`
        : 'Покупатель интересуется вашим товаром',
      'deal_created',
      deal.id,
    );

    return deal;
  }

  /** ДОСЛОВНАЯ ретрансляция. Модерация ДО записи. */
  async relay(senderId: string, p: { dealId: string; text: string }) {
    const deal = await this.prisma.deal.findUnique({
      where: { id: p.dealId },
      include: {
        buyer: { select: { id: true } },
        seller: { select: { id: true } },
      },
    });
    if (!deal) throw new NotFoundException('Сделка не найдена');

    const isBuyer = deal.buyerId === senderId;
    const isSeller = deal.sellerId === senderId;
    if (!isBuyer && !isSeller) {
      throw new ForbiddenException('Вы не участник сделки');
    }

    const text = (p.text || '').slice(0, MAX_RELAY_TEXT);

    const verdict = await this.moderation.moderate({
      text,
      entityType: 'deal_relay',
      entityId: deal.id,
      userId: senderId,
    });
    if (verdict.verdict === 'block') {
      await this.writeAssistantMsg(senderId, {
        text: 'Не могу передать: ' + verdict.reason,
        dealId: deal.id,
        meta: {
          relay: false,
          blocked: true,
          reason: verdict.reason,
          dealId: deal.id,
        },
      });
      return { blocked: true, reason: verdict.reason };
    }

    const receiverId = isBuyer ? deal.sellerId : deal.buyerId;
    const originRole = isBuyer ? 'buyer' : 'seller';

    await this.writeAssistantMsg(receiverId, {
      text,
      dealId: deal.id,
      meta: {
        relay: true,
        dealId: deal.id,
        originUserId: senderId,
        originRole,
        originalText: text,
      },
    });

    // первый контакт продавца переводит NEW → CONTACTED
    let statusChanged = false;
    if (deal.status === DealStatus.NEW && isSeller) {
      await this.prisma.deal.update({
        where: { id: deal.id },
        data: {
          status: DealStatus.CONTACTED,
          msgCount: { increment: 1 },
          lastMsgAt: new Date(),
        },
      });
      statusChanged = true;
    } else {
      await this.prisma.deal.update({
        where: { id: deal.id },
        data: { msgCount: { increment: 1 }, lastMsgAt: new Date() },
      });
    }

    await this.pushDealEvent(
      receiverId,
      'Сообщение по сделке',
      text.slice(0, 120),
      'relay_message',
      deal.id,
    );

    return { relayed: true, statusChanged };
  }

  /** «беру» → Order PENDING + deal ACCEPTED. */
  async accept(buyerId: string, dealId: string) {
    const deal = await this.prisma.deal.findUnique({
      where: { id: dealId },
      include: { product: { select: { id: true, price: true, isActive: true } } },
    });
    if (!deal) throw new NotFoundException('Сделка не найдена');
    if (deal.buyerId !== buyerId) throw new ForbiddenException('Вы не покупатель сделки');
    if (!deal.productId) {
      throw new BadRequestException('Сделка без товара — уточните, что именно берёте');
    }
    // N4: accept разрешён ТОЛЬКО из статусов активного диалога.
    //   NEW        — сделка создана, покупатель сразу нажал «беру»;
    //   CONTACTED  — продавец ответил;
    //   NEGOTIATING— шёл торг.
    // LOST / CLOSED / ACCEPTED исключены намеренно: раньше гард ловил только
    // ACCEPTED|CLOSED, поэтому accept на отменённой (LOST) сделке создавал
    // НОВЫЙ Order → дубликаты заказов и повторные списания.
    const ACCEPTABLE: DealStatus[] = [
      DealStatus.NEW,
      DealStatus.CONTACTED,
      DealStatus.NEGOTIATING,
    ];
    if (!ACCEPTABLE.includes(deal.status)) {
      throw new BadRequestException(
        `Сделку нельзя принять в статусе ${deal.status}`,
      );
    }
    // Идемпотентность: заказ уже создан — второй не плодим.
    if (deal.orderId) {
      throw new BadRequestException('По сделке уже создан заказ');
    }
    if (!deal.product?.isActive) {
      throw new BadRequestException('Товар недоступен');
    }

    // D7 (§7.4): комиссии считаются ЗДЕСЬ — ровно тем же расчётом, что и в
    // OrdersService.create. Раньше Order создавался без platformFee/
    // referralBonus (default 0) → продавец получал 100%, платформа 0.
    // Ставки снапшотятся в заказ и позже не пересчитываются.
    const amount = round2(deal.cashPrice ?? deal.product.price);
    const buyer = await this.prisma.user.findUnique({
      where: { id: deal.buyerId },
      select: { invitedById: true },
    });
    const platformPercent =
      (await this.settings.getFloat('platform_fee_percent')) || 10;
    const referralPercent =
      (await this.settings.getFloat('referral_percent')) || 5;
    const referralUserId = buyer?.invitedById || null;
    const fees = computeFees(
      amount,
      platformPercent,
      referralPercent,
      Boolean(referralUserId),
    );

    const order = await this.prisma.order.create({
      data: {
        buyerId: deal.buyerId,
        sellerId: deal.sellerId,
        productId: deal.productId,
        amount,
        platformFee: fees.platformFee,
        referralBonus: fees.referralBonus,
        referralUserId,
        status: OrderStatus.PENDING,
        // §1.2: обратная связь Deal ↔ Order и снапшот источника цены.
        dealId,
        priceSource:
          deal.cashPrice != null ? PriceSource.DEAL : PriceSource.PRODUCT,
      },
    });

    await this.prisma.deal.update({
      where: { id: dealId },
      data: { status: DealStatus.ACCEPTED, orderId: order.id },
    });

    await this.pushDealEvent(
      deal.sellerId,
      'Сделка принята',
      'Покупатель подтвердил, ждите оплату',
      'deal_accepted',
      dealId,
    );

    return order;
  }

  /** Отмена / отказ → LOST. Не теряет деньги по оплаченному заказу (§8.2). */
  async lose(userId: string, dealId: string, reason?: string) {
    const deal = await this.prisma.deal.findUnique({
      where: { id: dealId },
      include: {
        order: { select: { id: true, status: true, escrowStatus: true } },
      },
    });
    if (!deal) throw new NotFoundException('Сделка не найдена');
    if (deal.buyerId !== userId && deal.sellerId !== userId) {
      throw new ForbiddenException('Вы не участник сделки');
    }

    await this.prisma.deal.update({
      where: { id: dealId },
      data: { status: DealStatus.LOST },
    });

    // §8.2: если по сделке уже есть оплаченный заказ с замороженным эскроу —
    // отмена сделки НЕ должна оставлять деньги в подвешенном состоянии.
    // Возвращаем эскроу покупателю (идемпотентно по escrowStatus/refKey).
    if (deal.order && deal.order.escrowStatus === EscrowStatus.HELD) {
      await this.escrow
        .refundEscrow(deal.order.id, 'deal_cancelled', 100)
        .catch((e) =>
          this.logger.error(
            `lose(): refund escrow for order ${deal.order?.id} failed: ${(e as Error).message}`,
          ),
        );
    }

    const msg = reason ? `Сделка отменена: ${reason}` : 'Сделка отменена';
    await this.pushDealEvent(userId === deal.buyerId ? deal.sellerId : deal.buyerId, 'Сделка отменена', msg, 'deal_lost', dealId);
    return { lost: true };
  }

  /** Фича 2: контр-оффер (торг). Валидация цены, перевод в NEGOTIATING, ретрансляция. */
  async counterOffer(
    userId: string,
    p: { dealId: string; amount: number },
  ) {
    const deal = await this.prisma.deal.findUnique({
      where: { id: p.dealId },
      include: { product: { select: { price: true, title: true } } },
    });
    if (!deal) throw new NotFoundException('Сделка не найдена');
    if (deal.buyerId !== userId && deal.sellerId !== userId) {
      throw new ForbiddenException('Вы не участник сделки');
    }
    if (!deal.product) {
      throw new BadRequestException('Сделка без товара — торг невозможен');
    }

    const amount = Number(p.amount);
    const base = deal.cashPrice ?? deal.product.price;
    if (!Number.isFinite(amount) || amount <= 0 || amount > base * 2) {
      throw new BadRequestException('Недопустимая цена предложения');
    }

    const offer = await this.prisma.counterOffer.create({
      data: {
        dealId: deal.id,
        byUserId: userId,
        amount,
        status: 'PENDING',
      },
    });

    // Согласованная цена ещё не зафиксирована — пока NEGOTIATING.
    const statusPatch: any = { status: DealStatus.NEGOTIATING, lastMsgAt: new Date(), msgCount: { increment: 1 } };
    await this.prisma.deal.update({
      where: { id: deal.id },
      data: statusPatch,
    });

    const isBuyer = deal.buyerId === userId;
    const receiverId = isBuyer ? deal.sellerId : deal.buyerId;
    const baseText = isBuyer
      ? `Покупатель предлагает ${amount} вместо ${base} — примете?`
      : `Продавец предлагает ${amount} — согласны?`;

    await this.writeAssistantMsg(receiverId, {
      text: baseText,
      dealId: deal.id,
      meta: {
        relay: false,
        dealId: deal.id,
        counterOfferId: offer.id,
        amount,
      },
    });
    await this.pushDealEvent(receiverId, 'Новое предложение по сделке', baseText, 'counter_offer', deal.id);

    return offer;
  }

  /** Принять оффер: фиксируем cashPrice, ACCEPTED у оффера, deal NEGOTIATING (ждём accept покупателя). */
  async acceptOffer(userId: string, p: { dealId: string; offerId: string }) {
    const deal = await this.prisma.deal.findUnique({ where: { id: p.dealId } });
    if (!deal) throw new NotFoundException('Сделка не найдена');
    if (deal.buyerId !== userId && deal.sellerId !== userId) {
      throw new ForbiddenException('Вы не участник сделки');
    }

    const offer = await this.prisma.counterOffer.findUnique({ where: { id: p.offerId } });
    if (!offer || offer.dealId !== deal.id) {
      throw new NotFoundException('Предложение не найдено');
    }
    // N3: нельзя принимать СВОЁ предложение — иначе покупатель сам себе
    // фиксирует cashPrice, а продавец узнаёт о «согласованной» цене постфактум.
    if (offer.byUserId === userId) {
      throw new BadRequestException('Нельзя принять своё предложение');
    }
    if (offer.status === 'ACCEPTED') {
      throw new BadRequestException('Предложение уже принято');
    }
    if (offer.status === 'REJECTED') {
      throw new BadRequestException('Предложение уже отклонено');
    }

    await this.prisma.counterOffer.update({
      where: { id: offer.id },
      data: { status: 'ACCEPTED' },
    });
    // Прочие PENDING-офферы отклоняем — побеждает этот.
    await this.prisma.counterOffer.updateMany({
      where: { dealId: deal.id, status: 'PENDING', id: { not: offer.id } },
      data: { status: 'REJECTED' },
    });
    await this.prisma.deal.update({
      where: { id: deal.id },
      data: { cashPrice: offer.amount, lastMsgAt: new Date() },
    });

    return { accepted: true, cashPrice: offer.amount };
  }

  /** Отклонить оффер. */
  async rejectOffer(userId: string, p: { dealId: string; offerId: string }) {
    const deal = await this.prisma.deal.findUnique({ where: { id: p.dealId } });
    if (!deal) throw new NotFoundException('Сделка не найдена');
    if (deal.buyerId !== userId && deal.sellerId !== userId) {
      throw new ForbiddenException('Вы не участник сделки');
    }
    const offer = await this.prisma.counterOffer.findUnique({ where: { id: p.offerId } });
    if (!offer || offer.dealId !== deal.id) {
      throw new NotFoundException('Предложение не найдено');
    }
    // N3 (reject): та же дыра — отклонять своё предложение бессмысленно и
    // позволяет автору «закрыть» оффер, который контрагент уже готов принять.
    if (offer.byUserId === userId) {
      throw new BadRequestException('Нельзя отклонить своё предложение');
    }
    if (offer.status !== 'PENDING') {
      throw new BadRequestException(`Предложение уже ${offer.status}`);
    }
    await this.prisma.counterOffer.update({
      where: { id: offer.id },
      data: { status: 'REJECTED' },
    });
    return { rejected: true };
  }

  /**
   * N1: закрытие сделки, когда её заказ завершён.
   * Единственный писатель CLOSED раньше был только арбитраж → успешные сделки
   * висели в ACCEPTED вечно (и ломали successRate в репутации).
   * Вызывается из cron DealTimeoutService (чужой orders.service не трогаем).
   */
  async closeDealsForCompletedOrders(): Promise<number> {
    const deals = await this.prisma.deal.findMany({
      where: {
        status: DealStatus.ACCEPTED,
        orderId: { not: null },
        order: { status: OrderStatus.COMPLETED },
      },
      select: { id: true, buyerId: true, sellerId: true },
    });

    for (const deal of deals) {
      await this.prisma.deal.update({
        where: { id: deal.id },
        data: { status: DealStatus.CLOSED },
      });
      await this.pushDealEvent(
        deal.buyerId,
        'Сделка завершена',
        'Заказ выполнен, сделка закрыта. Спасибо!',
        'deal_closed',
        deal.id,
      );
    }
    return deals.length;
  }

  /** Точечное закрытие одной сделки по завершённому заказу (для вызовов извне). */
  async closeIfOrderCompleted(dealId: string): Promise<boolean> {
    const deal = await this.prisma.deal.findUnique({
      where: { id: dealId },
      include: { order: { select: { status: true } } },
    });
    if (
      !deal ||
      deal.status !== DealStatus.ACCEPTED ||
      deal.order?.status !== OrderStatus.COMPLETED
    ) {
      return false;
    }
    await this.prisma.deal.update({
      where: { id: dealId },
      data: { status: DealStatus.CLOSED },
    });
    await this.pushDealEvent(
      deal.buyerId,
      'Сделка завершена',
      'Заказ выполнен, сделка закрыта. Спасибо!',
      'deal_closed',
      dealId,
    );
    return true;
  }

  // ─── N2: спор (dispute) ────────────────────────────────────────────────
  // Раньше dispute='OPEN' никто не выставлял → арбитраж был мёртвой веткой.
  private static readonly DISPUTABLE: DealStatus[] = [
    DealStatus.ACCEPTED,
    DealStatus.CONTACTED,
    DealStatus.NEGOTIATING,
  ];

  /** Открыть спор участником сделки. */
  async openDispute(userId: string, dealId: string, reason?: string) {
    const deal = await this.prisma.deal.findUnique({
      where: { id: dealId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        status: true,
        dispute: true,
        orderId: true,
      },
    });
    if (!deal) throw new NotFoundException('Сделка не найдена');
    if (deal.buyerId !== userId && deal.sellerId !== userId) {
      throw new ForbiddenException('Вы не участник сделки');
    }
    if (deal.dispute === 'OPEN') {
      throw new BadRequestException('Спор уже открыт');
    }
    if (deal.dispute === 'RESOLVED') {
      throw new BadRequestException('Спор по сделке уже рассмотрен');
    }
    // Спор имеет смысл только на живой сделке — на LOST/CLOSED делить нечего.
    if (!DealService.DISPUTABLE.includes(deal.status)) {
      throw new BadRequestException(
        `Нельзя открыть спор в статусе ${deal.status}`,
      );
    }

    const note = (reason || '').slice(0, 500) || 'Спор открыт участником';

    // D1 (§4.4, §5.3): спор ОБЯЗАН остановить таймер эскроу. Без синхронизации
    // Order.status остаётся PAID/SHIPPED, и autoCloseOrders через 5/7 дней
    // двигает деньги, пока арбитраж ещё думает (а потом молча выходит,
    // увидев escrowStatus !== HELD).
    await this.prisma.$transaction(async (tx) => {
      await tx.deal.update({
        where: { id: dealId },
        data: { dispute: 'OPEN', disputeNote: note },
      });

      if (deal.orderId) {
        await tx.order.updateMany({
          where: {
            id: deal.orderId,
            status: {
              in: [
                OrderStatus.PAID,
                OrderStatus.SHIPPED,
                OrderStatus.DISPUTED,
              ],
            },
          },
          data: {
            status: OrderStatus.DISPUTED,
            autoCompleteAt: null,
          },
        });
      }
    });

    const counterpartyId =
      userId === deal.buyerId ? deal.sellerId : deal.buyerId;
    await this.pushDealEvent(
      counterpartyId,
      'Открыт спор',
      `Контрагент открыл спор: ${note.slice(0, 120)}`,
      'deal_dispute',
      dealId,
    );
    await this.pushDealEvent(
      userId,
      'Спор открыт',
      'Арбитр изучит переписку и вынесет решение автоматически.',
      'deal_dispute',
      dealId,
    );

    return { dispute: 'OPEN' };
  }

  /** Статус заказа текстом. */
  async orderStatus(userId: string, orderId?: string) {
    if (!orderId) {
      const last = await this.prisma.order.findFirst({
        where: { OR: [{ buyerId: userId }, { sellerId: userId }] },
        orderBy: { createdAt: 'desc' },
      });
      if (!last) return { text: 'Заказов пока нет' };
      return this.orderStatusText(last);
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId as string },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (order.buyerId !== userId && order.sellerId !== userId) {
      throw new ForbiddenException('Это не ваш заказ');
    }
    return this.orderStatusText(order);
  }

  private orderStatusText(order: { status: string; id: string; amount: number }) {
    const map: Record<string, string> = {
      PENDING: 'ожидает оплаты',
      PAID: 'оплачен',
      SHIPPED: 'отправлен',
      COMPLETED: 'завершён',
      CANCELLED: 'отменён',
    };
    return {
      text: `Заказ #${order.id.slice(0, 8)} — ${map[order.status] ?? order.status} (${order.amount} USDT)`,
      order,
    };
  }

  /** ask_availability — ретранслирует вопрос продавцу без deal. */
  async relayAvailability(askerId: string, productId: string) {
    const prod = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!prod) throw new NotFoundException('Товар не найден');
    const text = prod.isActive
      ? `Товар «${prod.title}» в наличии.`
      : `Товар «${prod.title}» снят с продажи.`;
    await this.writeAssistantMsg(askerId, {
      text,
      meta: { relay: false, action: { intent: 'ask_availability', payload: { productId } } },
    });
    return { text, inStock: prod.isActive };
  }

  /** Тред сделки: Deal + все сообщения по dealId. */
  async thread(dealId: string, viewerId: string) {
    const deal = await this.prisma.deal.findUnique({
      where: { id: dealId },
      include: {
        buyer: { select: { id: true, name: true } },
        seller: { select: { id: true, name: true } },
        product: { select: { id: true, title: true, price: true, media: true } },
        order: { select: { id: true, status: true, amount: true } },
      },
    });
    if (!deal) throw new NotFoundException('Сделка не найдена');
    if (deal.buyerId !== viewerId && deal.sellerId !== viewerId) {
      throw new ForbiddenException('Вы не участник сделки');
    }

    const thread = await this.prisma.bazarMessage.findMany({
      where: { dealId },
      orderBy: { createdAt: 'asc' },
    });

    return { deal, thread };
  }

  /** Список сделок (лиды). */
  async list(userId: string, as: 'buyer' | 'seller') {
    const where = as === 'buyer' ? { buyerId: userId } : { sellerId: userId };
    return this.prisma.deal.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        buyer: { select: { id: true, name: true } },
        seller: { select: { id: true, name: true } },
        product: { select: { id: true, title: true, price: true, media: true } },
        order: { select: { id: true, status: true, amount: true } },
      },
    });
  }

  private async writeAssistantMsg(
    userId: string,
    d: { text: string; dealId?: string; meta?: Prisma.InputJsonValue },
  ) {
    return this.prisma.bazarMessage.create({
      data: {
        userId,
        role: BazarRole.ASSISTANT,
        text: d.text,
        dealId: d.dealId,
        meta: (d.meta as Prisma.InputJsonValue) ?? Prisma.JsonNull,
      },
    });
  }

  private async pushDealEvent(
    userId: string,
    heading: string,
    content: string,
    type: string,
    dealId: string,
  ) {
    await this.notify.createNotification(userId, type, content, dealId).catch(() => null);
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