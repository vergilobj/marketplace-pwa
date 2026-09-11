import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  Request,
  Query,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../common/types/authenticated-request.interface';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { ForceOrderStatusDto } from './dto/force-order-status.dto';

@Controller('orders')
export class OrdersController {
  constructor(private ordersService: OrdersService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BUYER', 'ADMIN')
  @Post()
  async create(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreateOrderDto,
  ) {
    return this.ordersService.create(req.user.userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('my')
  async findMyOrders(
    @Request() req: AuthenticatedRequest,
    @Query('status') status?: string,
  ) {
    return this.ordersService.findMyOrders(
      req.user.userId,
      req.user.role,
      status,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async findById(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.ordersService.findById(id, req.user.userId, req.user.role);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BUYER', 'SELLER', 'ADMIN')
  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(
      id,
      req.user.userId,
      req.user.role,
      dto,
    );
  }

  /** §4.3: покупатель подтверждает получение → релиз эскроу продавцу. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BUYER')
  @Post(':id/confirm')
  async confirmReceipt(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.ordersService.confirmReceipt(id, req.user.userId);
  }

  /**
   * NH8: покупатель отзывает спор («оставляю как есть»). Заказ возвращается в
   * SHIPPED и снова идёт обычным путём (подтверждение/авто-релиз по таймеру) —
   * иначе заказ без Deal навсегда зависал бы в DISPUTED с эскроу в HELD.
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BUYER')
  @Post(':id/dispute/withdraw')
  async withdrawDispute(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.ordersService.resolveDispute(id, req.user.userId);
  }

  /** §3: ручной обход матрицы админом. Обязателен reason (AuditLog). */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Patch(':id/force-status')
  async forceStatus(
    @Param('id') id: string,
    @Body() dto: ForceOrderStatusDto,
  ) {
    return this.ordersService.adminForceStatus(id, dto, dto.reason);
  }
}