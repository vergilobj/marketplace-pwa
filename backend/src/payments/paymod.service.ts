import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * HTTP-клиент sidecar paymod: подписывает запросы HMAC-SHA256 и валидирует
 * входящие webhook-подписи (ТЗ раздел 4.3).
 *
 * Подпись: base64( HMAC-SHA256( secret, timestamp + "." + raw_body ) ).
 * Окно допустимости — 60 с.
 */
@Injectable()
export class PaymodService {
  private readonly logger = new Logger(PaymodService.name);
  private readonly secret: string;
  private readonly baseUrl: string;

  constructor(private config: ConfigService) {
    this.secret = this.config.getOrThrow<string>('PAYMOD_SHARED_SECRET');
    this.baseUrl =
      this.config.get<string>('PAYMOD_SIDECAR_URL') || 'http://127.0.0.1:8100';
  }

  private sign(timestamp: string, rawBody: string): string {
    const message = `${timestamp}.${rawBody}`;
    return createHmac('sha256', this.secret).update(message).digest('base64');
  }

  private verify(timestamp: string, rawBody: string, signature: string): boolean {
    if (!timestamp || !signature) return false;
    // Проверка окна 60 с (анти-replay)
    const now = Math.floor(Date.now() / 1000);
    const ts = parseInt(timestamp, 10);
    if (!Number.isFinite(ts) || Math.abs(now - ts) > 60) return false;

    const expected = this.sign(timestamp, rawBody);
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  private async request<T = any>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const rawBody = body ? JSON.stringify(body) : '';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = this.sign(timestamp, rawBody);

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Paymod-Timestamp': timestamp,
        'X-Paymod-Signature': signature,
      },
      body: method === 'GET' ? undefined : rawBody,
    });

    if (!res.ok) {
      const err = await res.text();
      this.logger.error(`paymod ${method} ${path} failed: ${res.status} ${err}`);
      throw new Error(`paymod error: ${res.status} ${err}`);
    }
    return (await res.json()) as T;
  }

  /** Получить/дерive детерминированный депозит-адрес (идемпотентно). */
  async getAddress(clientRef: string, chain: string, token: string): Promise<string> {
    const data = await this.request<{ address: string }>('POST', '/v1/address', {
      client_ref: clientRef,
      chain,
      token,
    });
    return data.address;
  }

  /** Инициировать выплату из казны (идемпотентно по idempotencyKey). */
  async payout(payload: {
    idempotency_key: string;
    client_ref?: string;
    to_address: string;
    amount: string;
    token: string;
    chain: string;
  }): Promise<{ tx_hash: string | null; status: string; error?: string; replayed?: boolean }> {
    return this.request('POST', '/v1/payout', payload as unknown as Record<string, unknown>);
  }

  /** Статус свипа/выплаты по хэшу. */
  async getTxStatus(txHash: string): Promise<{ tx_hash: string; status: string; confirmations: number }> {
    return this.request('GET', `/v1/tx/${txHash}`);
  }

  /** Валидация HMAC входящего webhook. timestamp+rawBody против подписи. */
  verifyWebhookSignature(timestamp: string, rawBody: string, signature: string): boolean {
    return this.verify(timestamp, rawBody, signature);
  }
}