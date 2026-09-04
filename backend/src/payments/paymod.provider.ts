import { Injectable, Logger } from '@nestjs/common';
import { PaymentProvider, PaymentResult } from './payment.provider';
import { PaymodService } from './paymod.service';

/**
 * Реализация PaymentProvider для крипто-платежей paymod.
 *
 * createPayment дергает sidecar POST /v1/address (детерминированный адрес по
 * client_ref), кладёт адрес в raw. Через PaymentsService transaction
 * сохраняется с provider=PAYMOD, clientRef, depositAddress, chain, token.
 */
@Injectable()
export class PaymodProvider extends PaymentProvider {
  private readonly logger = new Logger(PaymodProvider.name);

  constructor(private paymodService: PaymodService) {
    super();
  }

  async createPayment(
    amount: number,
    orderId: string,
    metadata?: any,
  ): Promise<PaymentResult> {
    const chain = metadata?.chain || 'bsc';
    const token = metadata?.token || 'USDT';
    const clientRef = metadata?.clientRef || `mp-txn-${orderId}`;

    const address = await this.paymodService.getAddress(clientRef, chain, token);
    this.logger.log(`paymod address derived: ${clientRef} -> ${address}`);

    return {
      success: true,
      transactionId: clientRef,
      status: 'pending',
      raw: {
        client_ref: clientRef,
        deposit_address: address,
        chain,
        token,
      },
    };
  }

  async verifyPayment(transactionId: string): Promise<PaymentResult> {
    // Статус депозита ведётся через webhook deposit (client_ref + tx_hash),
    // а не поллингом. Здесь возвращаем заглушку pending; фактическая отметка
    // CONFIRMED происходит в webhook-контроллере.
    return {
      success: false,
      transactionId,
      status: 'pending',
      raw: { note: 'resolved via deposit webhook' },
    };
  }
}