import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findByPhone(phone: string) {
    return this.prisma.user.findUnique({ where: { phone } });
  }

  async findAll() {
    return this.prisma.user.findMany({
      select: { id: true, phone: true, name: true, role: true, isApproved: true },
    });
  }

  async updateProfile(userId: string, dto: UpdateUserDto) {
    return this.prisma.user.update({
      where: { id: userId },
      data: dto,
    });
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
        id: true, phone: true, name: true, role: true,
        isApproved: true, referralCode: true, bonusBalance: true, createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ====== Вывод бонусов ======

  async getBalance(userId: string) {
    const user = await this.findById(userId);
    return { balance: user?.bonusBalance ?? 0 };
  }

  async requestWithdrawal(userId: string, amount: number) {
    const user = await this.findById(userId);
    if (!user) throw new Error('User not found');
    if (amount <= 0) throw new Error('Amount must be positive');

    // Считаем сумму уже поданных (pending) заявок
    const pendingRequests = await this.prisma.withdrawalRequest.findMany({
      where: { userId, status: 'pending' },
    });
    const totalPending = pendingRequests.reduce((sum, r) => sum + r.amount, 0);

    // Доступный для вывода остаток = баланс - сумма уже поданных заявок
    const available = user.bonusBalance - totalPending;
    if (available < amount) {
      throw new Error(`Insufficient bonus balance. Available: ${available} ₽`);
    }

    return this.prisma.withdrawalRequest.create({
      data: {
        userId,
        amount,
        status: 'pending',
      },
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
    const request = await this.prisma.withdrawalRequest.findUnique({ where: { id: requestId } });
    if (!request || request.status !== 'pending') throw new Error('Invalid request');

    // Проверяем, что у пользователя всё ещё хватает средств
    const user = await this.findById(request.userId);
    if (!user || user.bonusBalance < request.amount) {
      throw new Error('Insufficient balance');
    }

    // Одобряем: меняем статус и списываем бонусы
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
    const request = await this.prisma.withdrawalRequest.findUnique({ where: { id: requestId } });
    if (!request || request.status !== 'pending') throw new Error('Invalid request');
    return this.prisma.withdrawalRequest.update({
      where: { id: requestId },
      data: { status: 'rejected' },
    });
  }
}