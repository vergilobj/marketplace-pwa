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
  Request,
  Optional,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { AlertsService } from '../common/alerts/alerts.service';
import { Roles } from '../auth/roles.decorator';
import type { AuthenticatedRequest } from '../common/types/authenticated-request.interface';
import { PaymentsService } from './payments.service';
import { NowPaymentsProvider } from './nowpayments.provider';
import { CartPayDto } from './dto/cart-pay.dto';
import { parseLimit, parsePage } from '../common/dto/pagination.dto';

@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private paymentsService: PaymentsService,
    private nowPayments: NowPaymentsProvider,
    // G2: внешний канал алертов. @Optional — payments.controller.spec собирает
    // контроллер через Test.createTestingModule без AlertsService.
    @Optional() private readonly alerts?: AlertsService,
  ) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('order/:orderId/invoice')
  async createInvoice(@Param('orderId') orderId: string) {
    const result = await this.paymentsService.createPaymentForOrder(orderId);
    return result;
  }

  // Статус оплаты заказа — фронт поллит для отображения PENDING/CONFIRMED/SWEPT.
  // F2: owner-чек — читать может только участник заказа (buyer/seller) или ADMIN.
  @UseGuards(JwtAuthGuard)
  @Get('order/:orderId/status')
  async getOrderStatus(
    @Param('orderId') orderId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.paymentsService.getOrderPaymentStatus(orderId, {
      userId: req.user.userId,
      role: req.user.role,
    });
  }

  // Депозитный адрес для оплаты (BSC/USDT).
  // F2: owner-чек — тот же, что у status (чужой заказ → 403).
  @UseGuards(JwtAuthGuard)
  @Get('order/:orderId/pay')
  async getOrderPay(
    @Param('orderId') orderId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.paymentsService.getOrderPayAddress(orderId, {
      userId: req.user.userId,
      role: req.user.role,
    });
  }

  // Публичный эндпоинт: покупатель инициирует оплату заказа.
  // Создаёт платёж (или возвращает существующий депозит-адрес).
  @UseGuards(JwtAuthGuard)
  @Post('order/:orderId/pay')
  async payOrder(
    @Param('orderId') orderId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.paymentsService.payOrderAsBuyer(orderId, req.user.userId);
  }

  // A3: ОБЩАЯ оплата корзины — один QR/адрес на все позиции.
  //
  // Корзина из N товаров создаёт N заказов; здесь на них создаётся ОДНА
  // paymod-транзакция (clientRef = mp-cart-<hash>), а webhook раскладывает
  // депозит по заказам (каждый холдится на свой amount). Без этого эндпоинта
  // фронт деградирует к поштучным адресам.
  //
  // Роль BUYER не требуется: покупатель — обычный пользователь, а RolesGuard
  // при @Roles('BUYER') отклонил бы продавца, покупающего у другого продавца.
  // Владение заказами проверяет сервис (403 на чужой заказ).
  @UseGuards(JwtAuthGuard)
  @Post('cart/pay')
  async payCart(@Body() dto: CartPayDto, @Request() req: AuthenticatedRequest) {
    return this.paymentsService.createPaymentForCart(
      dto.orderIds,
      req.user.userId,
    );
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
      page: parsePage(page),
      limit: parseLimit(limit),
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

    this.logger.log(`IPN verified: order=${orderId} status=${paymentStatus}`);

    if (paymentStatus === 'finished' || paymentStatus === 'confirmed') {
      if (!orderId) {
        // Деньги пришли без привязки к заказу — молча терять нельзя.
        this.logger.error(
          `ALERT legacy IPN: finished без order_id, body=${JSON.stringify(body)}`,
        );
        // G2: деньги в сети есть, а к заказу не привязаны. Без внешнего
        // алерта такое всплывает только при ручном разборе логов.
        await this.alerts?.send({
          code: 'legacy_ipn_no_order_id',
          severity: 'error',
          message: `Legacy IPN: платёж finished без order_id — деньги не привязаны к заказу`,
          context: { body },
        });
        return { status: 'ok' };
      }

      // NH7: legacy-путь раньше подтверждал заказ БЕЗ сверки суммы — тот же
      // класс дыры, что B7, но в старом провайдере. Проверяем:
      //   1) заказ существует;
      //   2) у заказа есть legacy-транзакция NowPayments (paymod-заказы
      //      подтверждаются только своим webhook — не подпускаем чужой IPN);
      //   3) фактически оплаченная сумма совпадает с order.amount в допуске.
      const check = await this.paymentsService.verifyLegacyIpnPayment(
        orderId,
        body,
      );
      if (!check.ok) {
        this.logger.error(
          `ALERT legacy IPN: order=${orderId} НЕ подтверждён — ${check.reason}`,
        );
        // G2: IPN пришёл, но заказ НЕ подтверждён (сумма/провайдер/наличие).
        // Это либо попытка подделки, либо расхождение оплаты.
        await this.alerts?.send({
          code: 'legacy_ipn_not_confirmed',
          severity: 'error',
          message: `Legacy IPN: заказ ${orderId} НЕ подтверждён — ${check.reason}`,
          context: { orderId, reason: check.reason },
        });
        return { status: 'ok', confirmed: false, reason: check.reason };
      }

      await this.paymentsService.processSuccessfulPayment(orderId);
      this.logger.log(`Order ${orderId} marked as paid via IPN`);
    }

    return { status: 'ok' };
  }
}
