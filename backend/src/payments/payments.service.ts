import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { PaymentProvider, PaymentResult } from './payment.provider';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private prisma: PrismaService,
    private settingsService: SettingsService,
    @Inject('PAYMENT_PROVIDER') private paymentProvider: PaymentProvider,
  ) {}

  async createPaymentForOrder(orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new Error('Order not found');
    if (order.status !== 'PENDING') throw new Error('Order already paid or cancelled');

    // Рассчитываем комиссии только для обычных заказов (с товаром) и если они ещё не заданы
    if (order.productId !== null && order.platformFee === 0 && order.referralBonus === 0) {
        const platformPercent = await this.settingsService.getFloat('platform_fee_percent') || 10;
        const referralPercent = await this.settingsService.getFloat('referral_percent') || 5;
        const platformFee = (order.amount * platformPercent) / 100;
        const referralBonus = (order.amount * referralPercent) / 100;
        await this.prisma.order.update({
            where: { id: order.id },
            data: { platformFee, referralBonus },
        });
    }

    // Создаём платёж через провайдер
    const result = await this.paymentProvider.createPayment(order.amount, order.id);
    await this.prisma.order.update({
      where: { id: order.id },
      data: { transactionId: result.transactionId },
    });

    // Записываем транзакцию
    await this.prisma.transaction.create({
      data: {
        orderId: order.id,
        type: 'payment',
        amount: order.amount,
        status: result.status,
        payload: result.raw,
      },
    });

    return { transactionId: result.transactionId, status: result.status };
  }

  async processSuccessfulPayment(orderId: string) {
    // Вызывается, когда платёж подтверждён (через вебхук или заглушку)
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { buyer: true, seller: true, referralUser: true },
    });
    if (!order || order.status !== 'PENDING') return;

    await this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'PAID', paidAt: new Date() },
    });

    // Запись транзакций сплитования
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

    this.logger.log(`Order ${orderId} processed successfully with splits.`);
  }
}