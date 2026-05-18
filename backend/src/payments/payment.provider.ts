export interface PaymentResult {
    success: boolean;
    transactionId: string;
    status: 'pending' | 'success' | 'failed';
    raw: any;
  }
  
  export abstract class PaymentProvider {
    abstract createPayment(amount: number, orderId: string, metadata?: any): Promise<PaymentResult>;
    abstract verifyPayment(transactionId: string): Promise<PaymentResult>;
  }