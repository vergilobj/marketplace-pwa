import { Controller, Post, Param, Get, UseGuards, Query } from '@nestjs/common';
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
    await this.paymentsService.processSuccessfulPayment(orderId);
    return { message: 'Payment processed' };
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
}
