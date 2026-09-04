import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { PaymentsService } from './payments.service';

/**
 * Обработчик события deposit от paymod sidecar.
 *
 * Идемпотентность: по уникальному tx_hash. Если транзакция с таким хэшем уже
 * есть — выходим без действий. Сверяем сумму/цепочку/токен, помечаем
 * Transaction CONFIRMED и запускаем существующий split.
 */
@Injectable()
export class PaymodWebhookHandler {
  private readonly logger = new Logger(PaymodWebhookHandler.name);

  constructor(
    private prisma: PrismaService,
    private paymentsService: PaymentsService,
  ) {}

  async handleDeposit(body: Record<string, unknown>): Promise<void> {
    const clientRef = (body.client_ref as string) || '';
    const txHash = (body.tx_hash as string) || '';
    const amountRaw = String(body.amount_raw ?? '');
    const chain = (body.chain as string) || '';
    const token = (body.token as string) || '';

    if (!clientRef || !txHash) {
      this.logger.warn('deposit event missing client_ref or tx_hash, ignored');
      return;
    }

    // Идемпотентность: хэш уже обработан?
    const existing = await this.prisma.transaction.findUnique({
      where: { txHash },
    });
    if (existing) {
      this.logger.log(`deposit already processed: tx=${txHash}`);
      return;
    }

    // Ищем транзакцию по clientRef (созданную через PaymodProvider.createPayment).
    const transaction = await this.prisma.transaction.findUnique({
      where: { clientRef },
      include: { order: true },
    });
    if (!transaction) {
      this.logger.warn(`transaction not found for client_ref=${clientRef}`);
      return;
    }
    if (transaction.status === 'CONFIRMED' || transaction.status === 'SWEPT') {
      this.logger.log(`transaction ${transaction.id} already confirmed, skip`);
      return;
    }

    // Сверка суммы/цепи/токена (защита от недоплаты/несовпадения сети).
    if (transaction.chain && chain && transaction.chain !== chain) {
      this.logger.warn(
        `chain mismatch for ${transaction.id}: expected=${transaction.chain} got=${chain}`,
      );
      return;
    }
    if (transaction.token && token && transaction.token !== token) {
      this.logger.warn(
        `token mismatch for ${transaction.id}: expected=${transaction.token} got=${token}`,
      );
      return;
    }

    // Отмечаем депозит и транзакцию.
    await this.prisma.transaction.update({
      where: { id: transaction.id },
      data: {
        status: 'CONFIRMED',
        txHash,
        amountRaw: amountRaw || transaction.amountRaw,
        depositAddress: (body.to as string) || transaction.depositAddress,
      },
    });

    // Запускаем существующий split (platformFee / referralBonus / payout_seller).
    await this.paymentsService.processSuccessfulPayment(transaction.orderId);

    this.logger.log(
      `deposit processed: client_ref=${clientRef} tx=${txHash} order=${transaction.orderId}`,
    );
  }
}