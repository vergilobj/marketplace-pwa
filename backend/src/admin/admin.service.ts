import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  async getDashboard() {
    const [
      usersCount,
      ordersCount,
      productsCount,
      postsCount,
      pendingWithdrawalsCount,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.order.count(),
      this.prisma.product.count({ where: { isActive: true } }),
      this.prisma.post.count({ where: { isHidden: false } }),
      this.prisma.withdrawalRequest.count({ where: { status: 'pending' } }),
    ]);

    const revenue = await this.prisma.order.aggregate({
      _sum: { platformFee: true },
      where: { status: 'PAID' },
    });

    return {
      usersCount,
      ordersCount,
      productsCount,
      postsCount,
      pendingWithdrawalsCount,
      totalRevenue: revenue._sum.platformFee || 0,
    };
  }

  async getModerationLogs(page = 1, limit = 20) {
    const [items, total] = await Promise.all([
      this.prisma.moderationLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.moderationLog.count(),
    ]);
    return { items, total, page, pages: Math.ceil(total / limit) };
  }

  async getSellerStats() {
    const sellers = await this.prisma.user.findMany({
      where: { role: 'SELLER' },
      select: {
        id: true,
        name: true,
        phone: true,
        _count: { select: { products: true } },
      },
      orderBy: { name: 'asc' },
    });

    const stats = await Promise.all(
      sellers.map(async (seller) => {
        const orders = await this.prisma.order.aggregate({
          where: { sellerId: seller.id, status: 'PAID' },
          _count: { id: true },
          _sum: { amount: true },
        });
        return {
          id: seller.id,
          name: seller.name,
          phone: seller.phone,
          productsCount: seller._count.products,
          ordersCount: orders._count.id,
          revenue: orders._sum.amount || 0,
        };
      }),
    );

    return stats;
  }

  async exportUsers(): Promise<string> {
    const users = await this.prisma.user.findMany({
      select: {
        id: true,
        phone: true,
        name: true,
        role: true,
        bonusBalance: true,
        isApproved: true,
        createdAt: true,
        invitedById: true,
        referralCode: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const header =
      'id,phone,name,role,bonusBalance,isApproved,createdAt,invitedById,referralCode';
    const rows = users.map((u) =>
      [
        u.id,
        u.phone,
        u.name || '',
        u.role,
        u.bonusBalance,
        u.isApproved,
        u.createdAt.toISOString(),
        u.invitedById || '',
        u.referralCode,
      ].join(','),
    );
    return header + '\n' + rows.join('\n');
  }

  async backupDatabase(): Promise<{ success: boolean; file?: string }> {
    const { execSync } = await import('child_process');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-${timestamp}.sql`;
    const filepath = `./backups/${filename}`;

    try {
      execSync(`mkdir -p ./backups && pg_dump $DATABASE_URL > ${filepath}`, {
        env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
        stdio: 'pipe',
      });
      return { success: true, file: filename };
    } catch {
      return { success: false };
    }
  }
}
