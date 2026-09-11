/** Метаданные платежа — набор необязательных полей, состав зависит от провайдера. */
export interface PaymentMetadata {
  chain?: string;
  token?: string;
  clientRef?: string;
  currency?: string;
  description?: string;
  successUrl?: string;
  cancelUrl?: string;
}

export interface PaymentResult {
  success: boolean;
  transactionId: string;
  status: 'pending' | 'success' | 'failed';
  /** Сырой ответ провайдера: форма различается (paymod address vs nowpayments invoice). */
  raw: Record<string, any>;
}

export abstract class PaymentProvider {
  abstract createPayment(
    amount: number,
    orderId: string,
    metadata?: PaymentMetadata,
  ): Promise<PaymentResult>;
  abstract verifyPayment(transactionId: string): Promise<PaymentResult>;
}
