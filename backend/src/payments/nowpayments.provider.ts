import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { PaymentProvider, PaymentResult } from './payment.provider';

@Injectable()
export class NowPaymentsProvider extends PaymentProvider {
  private readonly logger = new Logger(NowPaymentsProvider.name);
  private readonly apiKey: string;
  private readonly ipnSecret: string;
  private readonly baseUrl: string;

  constructor(private config: ConfigService) {
    super();
    this.apiKey = this.config.getOrThrow<string>('NOWPAYMENTS_API_KEY');
    this.ipnSecret = this.config.getOrThrow<string>('NOWPAYMENTS_IPN_SECRET');
    this.baseUrl =
      this.config.get('NOWPAYMENTS_SANDBOX') === 'true'
        ? 'https://api-sandbox.nowpayments.io/v1'
        : 'https://api.nowpayments.io/v1';
  }

  async createPayment(
    amount: number,
    orderId: string,
    metadata?: any,
  ): Promise<PaymentResult> {
    const ipnUrl = this.config.get('NOWPAYMENTS_IPN_URL');
    if (!ipnUrl) {
      throw new Error('NOWPAYMENTS_IPN_URL is required');
    }

    const body = {
      price_amount: amount,
      price_currency: metadata?.currency || 'usd',
      order_id: orderId,
      order_description: metadata?.description || `Order ${orderId}`,
      ipn_callback_url: ipnUrl,
      success_url: metadata?.successUrl,
      cancel_url: metadata?.cancelUrl,
    };

    this.logger.log(`Creating invoice for order ${orderId}: ${amount} ${body.price_currency}`);

    const res = await fetch(`${this.baseUrl}/invoice`, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      this.logger.error(`NowPayments invoice creation failed: ${res.status} ${err}`);
      throw new Error(`NowPayments error: ${res.status}`);
    }

    const data = await res.json();
    this.logger.log(`Invoice created: ${data.invoice_url}`);

    return {
      success: true,
      transactionId: data.id || data.invoice_id,
      status: 'pending',
      raw: { ...data, invoice_url: data.invoice_url },
    };
  }

  async verifyPayment(transactionId: string): Promise<PaymentResult> {
    // NowPayments invoices don't have a direct GET status endpoint — use /payment list
    // TransactionId here is invoice_id; we query by order_id from the stored transaction
    const res = await fetch(
      `${this.baseUrl}/payment/?limit=1&order_id=${transactionId}`,
      {
        headers: { 'x-api-key': this.apiKey },
      },
    );

    if (!res.ok) {
      const err = await res.text();
      this.logger.warn(`NowPayments verify failed: ${res.status} ${err}`);
      return { success: false, transactionId, status: 'failed', raw: { error: err } };
    }

    const data = await res.json();
    const payment = data.data?.[0];
    if (!payment) {
      return { success: false, transactionId, status: 'pending', raw: {} };
    }

    const statusMap: Record<string, PaymentResult['status']> = {
      finished: 'success',
      confirmed: 'success',
      failed: 'failed',
      expired: 'failed',
      refunded: 'failed',
    };

    return {
      success: payment.payment_status === 'finished' || payment.payment_status === 'confirmed',
      transactionId,
      status: statusMap[payment.payment_status] || 'pending',
      raw: payment,
    };
  }

  /**
   * Verify HMAC-SHA512 signature from IPN webhook.
   * NowPayments signs the request body (sorted keys, JSON.stringify) with ipn_secret.
   */
  verifyIpnSignature(body: Record<string, unknown>, signature: string): boolean {
    const sortedBody = JSON.stringify(body, Object.keys(body).sort());
    const hmac = createHmac('sha512', this.ipnSecret)
      .update(sortedBody)
      .digest('hex');
    return hmac === signature;
  }

  /** Extract order_id from IPN body (NowPayments sends order_id in the IPN payload) */
  extractOrderId(body: Record<string, unknown>): string | null {
    return (body.order_id as string) || null;
  }
}
