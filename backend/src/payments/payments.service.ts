import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { NowPaymentsProvider } from './nowpayments.provider';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private prisma: PrismaService,
    private settingsService: SettingsService,
    private nowPayments: NowPaymentsProvider,
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

    // Create invoice via NowPayments
    const result = await this.nowPayments.createPayment(order.amount, order.id, {
      currency: 'usd',
      description: `Order ${order.id}`,
    });

    // Store transaction
    await this.prisma.transaction.create({
      data: {
        orderId: order.id,
        type: 'payment',
        amount: order.amount,
        status: 'pending',
        payload: result.raw,
      },
    });

    return {
      invoiceUrl: result.raw?.invoice_url,
      transactionId: result.transactionId,
      status: result.status,
    };
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
        `Начислен реферальный бонус: ${order.referralBonus} ₽`,
        orderId,
      );
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
