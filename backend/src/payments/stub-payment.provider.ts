import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PaymentProvider, PaymentResult } from './payment.provider';

@Injectable()
export class StubPaymentProvider extends PaymentProvider {
  async createPayment(amount: number, orderId: string): Promise<PaymentResult> {
    // Имитация успешного платежа
    const transactionId = `stub_${uuidv4()}`;
    return {
      success: true,
      transactionId,
      status: 'pending',
      raw: { message: 'Stub payment created', orderId, amount },
    };
  }

  async verifyPayment(transactionId: string): Promise<PaymentResult> {
    // Всегда возвращает успех
    return {
      success: true,
      transactionId,
      status: 'success',
      raw: { message: 'Stub payment verified' },
    };
  }
}