import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PaymentProvider, PaymentResult } from './payment.provider';

@Injectable()
export class StubPaymentProvider extends PaymentProvider {
  createPayment(amount: number, orderId: string): Promise<PaymentResult> {
    const transactionId = `stub_${uuidv4()}`;
    return Promise.resolve({
      success: true,
      transactionId,
      status: 'pending',
      raw: { message: 'Stub payment created', orderId, amount },
    });
  }

  verifyPayment(transactionId: string): Promise<PaymentResult> {
    return Promise.resolve({
      success: true,
      transactionId,
      status: 'success',
      raw: { message: 'Stub payment verified' },
    });
  }
}
