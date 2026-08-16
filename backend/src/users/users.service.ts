import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserRole } from '@prisma/client';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private notificationsService: NotificationsService,
  ) {}

  async findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findByPhone(phone: string) {
    return this.prisma.user.findUnique({ where: { phone } });
  }

  async findAll(params: { page?: number; limit?: number; search?: string }) {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const skip = (page - 1) * limit;
    const where: any = {};
    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: 'insensitive' } },
        { phone: { contains: params.search, mode: 'insensitive' } },
      ];
    }
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          phone: true,
          name: true,
          role: true,
          isApproved: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total, page, pages: Math.ceil(total / limit) };
  }

  async updateProfile(userId: string, dto: UpdateUserDto) {
    const updated = await this.prisma.user.update({ where: { id: userId }, data: dto });
    await this.auditService.log({
      userId,
      action: 'profile_updated',
      entity: 'user',
      entityId: userId,
    });
    return updated;
  }

  async getReferrals(userId: string) {
    return this.prisma.order.findMany({
      where: { referralUserId: userId },
      include: {
        buyer: { select: { id: true, name: true } },
        product: { select: { title: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async exportUsers() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        phone: true,
        name: true,
        role: true,
        isApproved: true,
        referralCode: true,
        bonusBalance: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Начисление реферального бонуса + внутренняя Notification + push (graceful).
   */
  async creditReferralBonus(userId: string, amount: number, orderId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { bonusBalance: { increment: amount } },
    });

    await this.notificationsService.createNotification(
      userId,
      'referral',
      `Начислен реферальный бонус: ${amount} ₽`,
      orderId,
    );

    try {
      await this.notificationsService.sendToUser(
        userId,
        { en: 'Реферальный бонус' },
        { en: `Начислен реферальный бонус: ${amount} ₽` },
        { screen: 'balance' },
      );
    } catch (err) {
      this.logger.warn(
        `Referral push for ${userId} failed: ${err.message}`,
      );
    }
  }

  // ====== Статистика ======
  async getStats(userId: string) {
    const [boughtCount, soldCount, referralOrders, balanceUser] =
      await Promise.all([
        this.prisma.order.count({ where: { buyerId: userId } }),
        this.prisma.order.count({ where: { sellerId: userId } }),
        this.prisma.order.aggregate({
          where: { referralUserId: userId },
          _sum: { referralBonus: true },
        }),
        this.prisma.user.findUnique({
          where: { id: userId },
          select: { bonusBalance: true },
        }),
      ]);

    return {
      boughtCount,
      soldCount,
      referralEarned: referralOrders._sum.referralBonus || 0,
      bonusBalance: balanceUser?.bonusBalance || 0,
    };
  }

  async getBalance(userId: string) {
    const user = await this.findById(userId);
    return { balance: user?.bonusBalance ?? 0 };
  }

  async requestWithdrawal(userId: string, amount: number) {
    const user = await this.findById(userId);
    if (!user) throw new Error('User not found');
    if (amount <= 0) throw new Error('Amount must be positive');
    const pendingRequests = await this.prisma.withdrawalRequest.findMany({
      where: { userId, status: 'pending' },
    });
    const totalPending = pendingRequests.reduce((sum, r) => sum + r.amount, 0);
    const available = user.bonusBalance - totalPending;
    if (available < amount)
      throw new Error(`Insufficient bonus balance. Available: ${available} ₽`);
    return this.prisma.withdrawalRequest.create({
      data: { userId, amount, status: 'pending' },
    });
  }

  async getMyWithdrawalRequests(userId: string) {
    return this.prisma.withdrawalRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAllWithdrawalRequests() {
    return this.prisma.withdrawalRequest.findMany({
      include: { user: { select: { id: true, name: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async approveWithdrawal(requestId: string) {
    const request = await this.prisma.withdrawalRequest.findUnique({
      where: { id: requestId },
    });
    if (!request || request.status !== 'pending')
      throw new Error('Invalid request');
    const user = await this.findById(request.userId);
    if (!user || user.bonusBalance < request.amount)
      throw new Error('Insufficient balance');
    await this.prisma.user.update({
      where: { id: request.userId },
      data: { bonusBalance: { decrement: request.amount } },
    });
    return this.prisma.withdrawalRequest.update({
      where: { id: requestId },
      data: { status: 'approved' },
    });
  }

  async rejectWithdrawal(requestId: string) {
    const request = await this.prisma.withdrawalRequest.findUnique({
      where: { id: requestId },
    });
    if (!request || request.status !== 'pending')
      throw new Error('Invalid request');
    return this.prisma.withdrawalRequest.update({
      where: { id: requestId },
      data: { status: 'rejected' },
    });
  }

  async changeRole(userId: string, newRole: UserRole) {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { role: newRole },
    });
    await this.auditService.log({
      action: 'role_changed',
      entity: 'user',
      entityId: userId,
    });
    return updated;
  }

  async batchChangeRole(userIds: string[], newRole: UserRole) {
    const result = await this.prisma.user.updateMany({
      where: { id: { in: userIds } },
      data: { role: newRole },
    });
    await this.auditService.log({
      action: 'batch_role',
      entity: 'user',
      metadata: { userIds, newRole, count: result.count },
    });
    return result;
  }

  async batchApprove(userIds: string[]) {
    const result = await this.prisma.user.updateMany({
      where: { id: { in: userIds }, isApproved: false },
      data: { isApproved: true },
    });
    await this.auditService.log({
      action: 'batch_approve',
      entity: 'user',
      metadata: { userIds, count: result.count },
    });
    return result;
  }
}