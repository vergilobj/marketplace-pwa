import { Controller, Post, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private paymentsService: PaymentsService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('order/:orderId/process')
  async processPayment(@Param('orderId') orderId: string) {
    await this.paymentsService.createPaymentForOrder(orderId);
    // Сразу имитируем подтверждение для теста
    await this.paymentsService.processSuccessfulPayment(orderId);
    return { message: 'Payment processed' };
  }
}