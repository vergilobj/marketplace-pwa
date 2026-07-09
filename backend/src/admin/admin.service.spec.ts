import { Test, TestingModule } from '@nestjs/testing';
import { AdminService } from './admin.service';
import { PrismaService } from '../common/prisma/prisma.service';

describe('AdminService', () => {
  let service: AdminService;

  const mockPrisma = {
    user: { count: jest.fn(), findMany: jest.fn() },
    order: { count: jest.fn(), aggregate: jest.fn() },
    product: { count: jest.fn() },
    post: { count: jest.fn() },
    withdrawalRequest: { count: jest.fn() },
    moderationLog: { findMany: jest.fn(), count: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<AdminService>(AdminService);
    jest.clearAllMocks();
  });

  it('should be defined', () => { expect(service).toBeDefined(); });

  describe('getDashboard', () => {
    it('should return dashboard stats', async () => {
      mockPrisma.user.count.mockResolvedValue(100);
      mockPrisma.order.count.mockResolvedValue(50);
      mockPrisma.product.count.mockResolvedValue(30);
      mockPrisma.post.count.mockResolvedValue(20);
      mockPrisma.withdrawalRequest.count.mockResolvedValue(5);
      mockPrisma.order.aggregate.mockResolvedValue({ _sum: { platformFee: 15000 } });
      const result = await service.getDashboard();
      expect(result.usersCount).toBe(100);
      expect(result.ordersCount).toBe(50);
      expect(result.productsCount).toBe(30);
      expect(result.postsCount).toBe(20);
      expect(result.pendingWithdrawalsCount).toBe(5);
      expect(result.totalRevenue).toBe(15000);
    });

    it('should handle null revenue', async () => {
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.order.count.mockResolvedValue(0);
      mockPrisma.product.count.mockResolvedValue(0);
      mockPrisma.post.count.mockResolvedValue(0);
      mockPrisma.withdrawalRequest.count.mockResolvedValue(0);
      mockPrisma.order.aggregate.mockResolvedValue({ _sum: { platformFee: null } });
      const result = await service.getDashboard();
      expect(result.totalRevenue).toBe(0);
    });
  });

  describe('getModerationLogs', () => {
    it('should return paginated logs', async () => {
      mockPrisma.moderationLog.findMany.mockResolvedValue([{ id: 'log-1' }]);
      mockPrisma.moderationLog.count.mockResolvedValue(1);
      const result = await service.getModerationLogs(1, 10);
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  describe('getSellerStats', () => {
    it('should return seller statistics', async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 's1', name: 'Seller 1', phone: '+7999', _count: { products: 10 } },
      ]);
      mockPrisma.order.aggregate.mockResolvedValue({ _count: { id: 5 }, _sum: { amount: 50000 } });
      const result = await service.getSellerStats();
      expect(result).toHaveLength(1);
      expect(result[0].productsCount).toBe(10);
      expect(result[0].ordersCount).toBe(5);
      expect(result[0].revenue).toBe(50000);
    });

    it('should handle empty sellers', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      const result = await service.getSellerStats();
      expect(result).toHaveLength(0);
    });
  });
});
