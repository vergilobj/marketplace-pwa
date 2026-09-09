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
} from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { ModerationService } from '../moderation/moderation.service';
import { NotificationsService } from '../notifications/notifications.service';

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
    if (deal.status === DealStatus.ACCEPTED || deal.status === DealStatus.CLOSED) {
      throw new BadRequestException('Сделка уже принята');
    }
    if (!deal.product?.isActive) {
      throw new BadRequestException('Товар недоступен');
    }

    const order = await this.prisma.order.create({
      data: {
        buyerId: deal.buyerId,
        sellerId: deal.sellerId,
        productId: deal.productId,
        amount: deal.cashPrice ?? deal.product.price,
        status: OrderStatus.PENDING,
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

  /** Отмена / отказ → LOST. */
  async lose(userId: string, dealId: string, reason?: string) {
    const deal = await this.prisma.deal.findUnique({ where: { id: dealId } });
    if (!deal) throw new NotFoundException('Сделка не найдена');
    if (deal.buyerId !== userId && deal.sellerId !== userId) {
      throw new ForbiddenException('Вы не участник сделки');
    }

    await this.prisma.deal.update({
      where: { id: dealId },
      data: { status: DealStatus.LOST },
    });

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
    if (offer.status === 'ACCEPTED') {
      throw new BadRequestException('Предложение уже принято');
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
    await this.prisma.counterOffer.update({
      where: { id: offer.id },
      data: { status: 'REJECTED' },
    });
    return { rejected: true };
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