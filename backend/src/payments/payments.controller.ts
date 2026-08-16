import {
  Controller,
  Post,
  Param,
  Get,
  UseGuards,
  Query,
  Body,
  Headers,
  HttpCode,
  Logger,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PaymentsService } from './payments.service';
import { NowPaymentsProvider } from './nowpayments.provider';

@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private paymentsService: PaymentsService,
    private nowPayments: NowPaymentsProvider,
  ) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('order/:orderId/invoice')
  async createInvoice(@Param('orderId') orderId: string) {
    const result = await this.paymentsService.createPaymentForOrder(orderId);
    return result;
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('transactions')
  async getTransactions(
    @Query('type') type?: string,
    @Query('orderSearch') orderSearch?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.paymentsService.getAllTransactions({
      type,
      orderSearch,
      page: Number(page) || 1,
      limit: Number(limit) || 20,
    });
  }

  @Post('ipn')
  @HttpCode(200)
  async handleIpn(
    @Body() body: Record<string, unknown>,
    @Headers('x-nowpayments-sig') signature: string,
  ) {
    // Verify HMAC-SHA512 signature
    if (!signature || !this.nowPayments.verifyIpnSignature(body, signature)) {
      this.logger.warn('IPN rejected: invalid signature');
      return { status: 'rejected', reason: 'invalid_signature' };
    }

    const orderId = this.nowPayments.extractOrderId(body);
    const paymentStatus = body.payment_status as string;

    this.logger.log(
      `IPN verified: order=${orderId} status=${paymentStatus}`,
    );

    if (
      paymentStatus === 'finished' ||
      paymentStatus === 'confirmed'
    ) {
      if (orderId) {
        await this.paymentsService.processSuccessfulPayment(orderId);
        this.logger.log(`Order ${orderId} marked as paid via IPN`);
      }
    }

    return { status: 'ok' };
  }
}
