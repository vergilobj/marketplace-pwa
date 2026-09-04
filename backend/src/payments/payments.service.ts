import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { NowPaymentsProvider } from './nowpayments.provider';
import { PaymodProvider } from './paymod.provider';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private prisma: PrismaService,
    private settingsService: SettingsService,
    private nowPayments: NowPaymentsProvider,
    private paymod: PaymodProvider,
    private notificationsService: NotificationsService,
  ) {}

  async createPaymentForOrder(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new Error('Order not found');
    if (order.status !== 'PENDING')
      throw new Error('Order already paid or cancelled');

    // Calculate split fees if not already set
    if (
      order.productId !== null &&
      order.platformFee === 0 &&
      order.referralBonus === 0
    ) {
      const platformPercent =
        (await this.settingsService.getFloat('platform_fee_percent')) || 10;
      const referralPercent =
        (await this.settingsService.getFloat('referral_percent')) || 5;
      const platformFee = (order.amount * platformPercent) / 100;
      const referralBonus = (order.amount * referralPercent) / 100;
      await this.prisma.order.update({
        where: { id: order.id },
        data: { platformFee, referralBonus },
      });
    }

    // Выбор провайдера. По умолчанию — paymod (BSC, USDT).
    const provider =
      (await this.settingsService.get('payment_provider')) || 'paymod';

    if (provider === 'paymod') {
      const chain = 'bsc';
      const token = 'USDT';
      const clientRef = `mp-txn-${order.id}`;

      // Депозит-адрес (детерминированный) через sidecar.
      const result = await this.paymod.createPayment(order.amount, order.id, {
        chain,
        token,
        clientRef,
      });

      const depositAddress = result.raw?.deposit_address;

      // amount — цена в USDT, в paymod передаём сырые атомарные единицы.
      // Условно 1 единица цены = 1 USDT => amountRaw = round(amount * 1e18).
      const amountRaw = String(Math.round(order.amount * 1e18));

      await this.prisma.transaction.create({
        data: {
          orderId: order.id,
          type: 'payment',
          amount: order.amount,
          status: 'PENDING',
          payload: result.raw,
          provider: 'PAYMOD',
          clientRef,
          depositAddress,
          chain,
          token,
          amountRaw,
        },
      });

      this.logger.log(
        `Paymod payment created: order=${order.id} addr=${depositAddress}`,
      );

      return {
        depositAddress,
        clientRef,
        status: 'PENDING',
      };
    }

    // Фолбэк — NowPayments (легаси).
    const result = await this.nowPayments.createPayment(order.amount, order.id, {
      currency: 'usd',
      description: `Order ${order.id}`,
    });

    await this.prisma.transaction.create({
      data: {
        orderId: order.id,
        type: 'payment',
        amount: order.amount,
        status: 'pending',
        payload: result.raw,
        provider: 'NOWPAYMENTS',
      },
    });

    return {
      invoiceUrl: result.raw?.invoice_url,
      transactionId: result.transactionId,
      status: result.status,
    };
  }

  /** Статус оплаты заказа: PENDING / CONFIRMED / SWEPT (+ depositAddress, txHash). */
  async getOrderPaymentStatus(orderId: string) {
    const tx = await this.prisma.transaction.findFirst({
      where: { orderId, type: 'payment' },
      orderBy: { createdAt: 'desc' },
    });
    if (!tx) {
      return { status: 'PENDING', depositAddress: null, txHash: null };
    }
    return {
      status: tx.status,
      depositAddress: tx.depositAddress,
      txHash: tx.txHash,
    };
  }

  /** Депозитный адрес для оплаты заказа (если создан через paymod). */
  async getOrderPayAddress(orderId: string) {
    const tx = await this.prisma.transaction.findFirst({
      where: { orderId, type: 'payment', provider: 'PAYMOD' },
      orderBy: { createdAt: 'desc' },
    });
    if (!tx?.depositAddress) {
      throw new Error('Payment address not found');
    }
    return { depositAddress: tx.depositAddress, clientRef: tx.clientRef };
  }

  async processSuccessfulPayment(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { buyer: true, seller: true, referralUser: true },
    });
    if (!order || order.status !== 'PENDING') return;

    // Update order status
    await this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'PAID', paidAt: new Date() },
    });

    // Create split transactions
    await this.prisma.transaction.createMany({
      data: [
        {
          orderId,
          type: 'payout_platform',
          amount: order.platformFee,
          status: 'success',
        },
        {
          orderId,
          type: 'payout_seller',
          amount: order.amount - order.platformFee - order.referralBonus,
          status: 'success',
        },
        ...(order.referralUserId
          ? [
              {
                orderId,
                type: 'payout_referral' as const,
                amount: order.referralBonus,
                status: 'success' as const,
              },
            ]
          : []),
      ],
    });

    // Credit referral bonus
    if (order.referralUserId && order.referralBonus > 0) {
      await this.prisma.user.update({
        where: { id: order.referralUserId },
        data: { bonusBalance: { increment: order.referralBonus } },
      });
      await this.notificationsService.createNotification(
        order.referralUserId,
        'referral',
        `Начислен реферальный бонус: ${order.referralBonus} USDT`,
        orderId,
      );
      try {
        await this.notificationsService.sendToUser(
          order.referralUserId,
          { en: 'Реферальный бонус' },
          { en: `Начислен реферальный бонус: ${order.referralBonus} USDT` },
          { screen: 'balance' },
        );
      } catch (err) {
        this.logger.warn(
          `Referral push for ${order.referralUserId} failed: ${err.message}`,
        );
      }
    }

    this.logger.log(`Order ${orderId} processed successfully with splits.`);
  }

  async getAllTransactions(filters?: {
    type?: string;
    orderSearch?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const skip = (page - 1) * limit;
    const where: any = {};
    if (filters?.type) {
      where.type = filters.type;
    }
    if (filters?.orderSearch) {
      where.orderId = { contains: filters.orderSearch, mode: 'insensitive' };
    }
    const [items, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          order: {
            select: { id: true, amount: true, status: true },
          },
        },
      }),
      this.prisma.transaction.count({ where }),
    ]);
    return { items, total, page, pages: Math.ceil(total / limit) };
  }
}
