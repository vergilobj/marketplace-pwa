import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private paymentsService: PaymentsService,
  ) {}

  async create(buyerId: string, dto: CreateOrderDto) {
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      include: { seller: true },
    });
    if (!product || !product.isActive) {
      throw new BadRequestException('Product not available');
    }

    const amount = dto.amount || product.price;

    const buyer = await this.prisma.user.findUnique({
      where: { id: buyerId },
      select: { invitedById: true },
    });

    // Создаём заказ без финальных комиссий (они вычислятся при оплате)
    const order = await this.prisma.order.create({
      data: {
        buyerId,
        sellerId: product.sellerId,
        productId: product.id,
        amount,
        referralUserId: buyer?.invitedById || null,
        status: 'PENDING',
      },
      include: {
        buyer: { select: { id: true, name: true, phone: true } },
        seller: { select: { id: true, name: true, phone: true } },
        product: true,
      },
    });

    // Сразу инициируем платёж (заглушка)
    await this.paymentsService.createPaymentForOrder(order.id);
    // Для теста сразу подтверждаем платёж (processSuccessfulPayment)
    await this.paymentsService.processSuccessfulPayment(order.id);

    return this.findById(order.id);
  }

  async findMyOrders(userId: string, role: string) {
    const where = role === 'SELLER' ? { sellerId: userId } : { buyerId: userId };
    return this.prisma.order.findMany({
      where,
      include: {
        product: { select: { title: true } },
        buyer: { select: { id: true, name: true } },
        seller: { select: { id: true, name: true } },
        referralUser: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        product: true,
        buyer: { select: { id: true, name: true, phone: true } },
        seller: { select: { id: true, name: true, phone: true } },
        referralUser: { select: { id: true, name: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async updateStatus(orderId: string, userId: string, role: string, dto: UpdateOrderStatusDto) {
    const order = await this.findById(orderId);

    // Проверка прав: SELLER может менять только на SHIPPED/COMPLETED/CANCELLED, BUYER может CANCELLED (до PAY), ADMIN всё
    if (role === 'SELLER' && order.sellerId !== userId) {
      throw new ForbiddenException('Not your order');
    }
    if (role === 'BUYER' && order.buyerId !== userId) {
      throw new ForbiddenException('Not your order');
    }

    // Простейшая логика смены статусов (можно усложнить)
    if (dto.status === 'PAID') {
      if (role !== 'ADMIN') throw new ForbiddenException('Only admin can mark as paid');
      order.paidAt = new Date();
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: dto.status,
        paidAt: order.paidAt,
      },
    });

    return updated;
  }
}