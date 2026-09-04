import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { PaymodService } from './paymod.service';
import { PaymodWebhookHandler } from './paymod-webhook.handler';

/**
 * Приём webhook'ов от paymod sidecar.
 *
 * POST /payments/paymod/webhook — событие deposit (и sweep.confirmed).
 * Валидация HMAC (timestamp+raw body), идемпотентность по tx_hash,
 * отметка Transaction CONFIRMED + запуск split.
 */
@Controller('payments/paymod')
export class PaymodWebhookController {
  private readonly logger = new Logger(PaymodWebhookController.name);

  constructor(
    private paymodService: PaymodService,
    private handler: PaymodWebhookHandler,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: Record<string, unknown>,
    @Headers('x-paymod-signature') signature: string,
    @Headers('x-paymod-timestamp') timestamp: string,
  ) {
    // Валидация HMAC по сырому телу (rawBody включён в main.ts).
    const rawBody = req.rawBody
      ? req.rawBody.toString('utf-8')
      : JSON.stringify(body);
    if (!this.paymodService.verifyWebhookSignature(timestamp, rawBody, signature)) {
      this.logger.warn('paymod webhook rejected: invalid signature or stale timestamp');
      return { status: 'rejected', reason: 'invalid_signature' };
    }

    const event = body.event as string;
    this.logger.log(`paymod webhook received: event=${event}`);

    if (event === 'deposit') {
      await this.handler.handleDeposit(body);
    } else {
      // sweep.confirmed и прочие — информативные, без изменения бизнес-состояния.
      this.logger.debug(`ignored paymod event: ${event}`);
    }

    return { status: 'ok' };
  }
}