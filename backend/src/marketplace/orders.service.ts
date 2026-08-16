import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { PaymentsService } from '../payments/payments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private paymentsService: PaymentsService,
    private notificationsService: NotificationsService,
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

    await this.paymentsService.createPaymentForOrder(order.id);
    await this.paymentsService.processSuccessfulPayment(order.id);

    // Уведомление продавцу
    await this.notificationsService.createNotification(
      product.sellerId,
      'order',
      `Новый заказ на сумму ${amount} ₽`,
      order.id,
    );

    await this.auditService.log({
      userId: buyerId,
      action: 'order_created',
      entity: 'order',
      entityId: order.id,
    });

    return this.findById(order.id);
  }

  async findMyOrders(userId: string, role: string, status?: string) {
    const where: any =
      role === 'SELLER' ? { sellerId: userId } : { buyerId: userId };
    if (status) {
      where.status = status;
    }
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

  async updateStatus(
    orderId: string,
    userId: string,
    role: string,
    dto: UpdateOrderStatusDto,
  ) {
    const order = await this.findById(orderId);

    if (role === 'SELLER' && order.sellerId !== userId) {
      throw new ForbiddenException('Not your order');
    }
    if (role === 'BUYER' && order.buyerId !== userId) {
      throw new ForbiddenException('Not your order');
    }

    if (dto.status === 'PAID') {
      if (role !== 'ADMIN')
        throw new ForbiddenException('Only admin can mark as paid');
      order.paidAt = new Date();
      // Уведомление покупателю
      await this.notificationsService.createNotification(
        order.buyerId,
        'order',
        `Ваш заказ оплачен`,
        orderId,
      );
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: dto.status,
        paidAt: order.paidAt,
      },
    });

    await this.auditService.log({
      userId,
      action: 'order_status_changed',
      entity: 'order',
      entityId: orderId,
    });

    return updated;
  }
}
