import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('UsersService', () => {
  let service: UsersService;
  let _prisma: any;

  const mockUser = {
    id: 'user-1',
    phone: '+79991112233',
    name: 'Test User',
    role: 'BUYER',
    bonusBalance: 500,
    isApproved: true,
    referralCode: 'ABC12345',
    createdAt: new Date(),
  };

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    order: {
      findMany: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    withdrawalRequest: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
  };

  const mockAudit = { log: jest.fn().mockResolvedValue({}) };
  const mockNotifications = {
    createNotification: jest.fn().mockResolvedValue({}),
    sendToUser: jest.fn().mockResolvedValue(null),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    _prisma = mockPrisma;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findById', () => {
    it('should return user by id', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      expect(await service.findById('user-1')).toEqual(mockUser);
    });

    it('should return null if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      expect(await service.findById('nonexistent')).toBeNull();
    });
  });

  describe('findByPhone', () => {
    it('should return user by phone', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      expect(await service.findByPhone('+79991112233')).toEqual(mockUser);
    });
  });

  describe('findAll', () => {
    it('should return paginated users', async () => {
      mockPrisma.user.findMany.mockResolvedValue([mockUser]);
      mockPrisma.user.count.mockResolvedValue(1);
      const result = await service.findAll({ page: 1, limit: 10 });
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.pages).toBe(1);
    });

    it('should filter by search query', async () => {
      mockPrisma.user.findMany.mockResolvedValue([mockUser]);
      mockPrisma.user.count.mockResolvedValue(1);
      await service.findAll({ search: 'Test' });
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              { name: { contains: 'Test', mode: 'insensitive' } },
              { phone: { contains: 'Test', mode: 'insensitive' } },
            ]),
          }),
        }),
      );
    });
  });

  describe('updateProfile', () => {
    it('should update user profile', async () => {
      mockPrisma.user.update.mockResolvedValue({
        ...mockUser,
        name: 'New Name',
      });
      const result = await service.updateProfile('user-1', {
        name: 'New Name',
      });
      expect(result.name).toBe('New Name');
    });
  });

  describe('getReferrals', () => {
    it('should return referral orders', async () => {
      mockPrisma.order.findMany.mockResolvedValue([
        { id: 'order-1', referralUserId: 'user-1' },
      ]);
      const result = await service.getReferrals('user-1');
      expect(result).toHaveLength(1);
    });
  });

  describe('exportUsers', () => {
    it('should export all users', async () => {
      mockPrisma.user.findMany.mockResolvedValue([mockUser]);
      expect(await service.exportUsers()).toHaveLength(1);
    });
  });

  describe('getStats', () => {
    it('should return user stats', async () => {
      mockPrisma.order.count.mockResolvedValueOnce(5).mockResolvedValueOnce(3);
      mockPrisma.order.aggregate.mockResolvedValue({
        _sum: { referralBonus: 150 },
      });
      mockPrisma.user.findUnique.mockResolvedValue({ bonusBalance: 500 });
      const result = await service.getStats('user-1');
      expect(result.boughtCount).toBe(5);
      expect(result.soldCount).toBe(3);
      expect(result.referralEarned).toBe(150);
      expect(result.bonusBalance).toBe(500);
    });

    it('should handle null aggregation', async () => {
      mockPrisma.order.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
      mockPrisma.order.aggregate.mockResolvedValue({
        _sum: { referralBonus: null },
      });
      mockPrisma.user.findUnique.mockResolvedValue({ bonusBalance: 0 });
      const result = await service.getStats('user-1');
      expect(result.referralEarned).toBe(0);
    });
  });

  describe('getBalance', () => {
    it('should return user balance', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ bonusBalance: 500 });
      expect(await service.getBalance('user-1')).toEqual({ balance: 500 });
    });

    it('should return 0 for unknown user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      expect(await service.getBalance('bad-id')).toEqual({ balance: 0 });
    });
  });

  describe('requestWithdrawal', () => {
    it('should throw if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.requestWithdrawal('bad-id', 100)).rejects.toThrow(
        'User not found',
      );
    });

    it('should throw if amount is not positive', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      await expect(service.requestWithdrawal('user-1', 0)).rejects.toThrow(
        'Amount must be positive',
      );
      await expect(service.requestWithdrawal('user-1', -10)).rejects.toThrow(
        'Amount must be positive',
      );
    });

    it('should throw if insufficient balance', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.withdrawalRequest.findMany.mockResolvedValue([]);
      await expect(service.requestWithdrawal('user-1', 1000)).rejects.toThrow(
        'Insufficient bonus balance',
      );
    });

    it('should create withdrawal request', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.withdrawalRequest.findMany.mockResolvedValue([]);
      mockPrisma.withdrawalRequest.create.mockResolvedValue({
        id: 'wr-1',
        amount: 100,
        status: 'pending',
      });
      const result = await service.requestWithdrawal('user-1', 100);
      expect(result.status).toBe('pending');
      expect(result.amount).toBe(100);
    });

    it('should consider pending requests in balance check', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.withdrawalRequest.findMany.mockResolvedValue([
        { amount: 450, status: 'pending' },
      ]);
      await expect(service.requestWithdrawal('user-1', 100)).rejects.toThrow(
        'Insufficient bonus balance',
      );
    });
  });

  describe('approveWithdrawal', () => {
    it('should throw if request not found', async () => {
      mockPrisma.withdrawalRequest.findUnique.mockResolvedValue(null);
      await expect(service.approveWithdrawal('bad-id')).rejects.toThrow(
        'Invalid request',
      );
    });

    it('should throw if request not pending', async () => {
      mockPrisma.withdrawalRequest.findUnique.mockResolvedValue({
        id: 'wr-1',
        userId: 'user-1',
        amount: 100,
        status: 'approved',
      });
      await expect(service.approveWithdrawal('wr-1')).rejects.toThrow(
        'Invalid request',
      );
    });

    it('should approve and decrement balance', async () => {
      mockPrisma.withdrawalRequest.findUnique.mockResolvedValue({
        id: 'wr-1',
        userId: 'user-1',
        amount: 100,
        status: 'pending',
      });
      mockPrisma.user.findUnique.mockResolvedValue({ bonusBalance: 500 });
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.withdrawalRequest.update.mockResolvedValue({
        id: 'wr-1',
        status: 'approved',
      });
      const result = await service.approveWithdrawal('wr-1');
      expect(result.status).toBe('approved');
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { bonusBalance: { decrement: 100 } },
      });
    });
  });

  describe('rejectWithdrawal', () => {
    it('should reject pending request', async () => {
      mockPrisma.withdrawalRequest.findUnique.mockResolvedValue({
        id: 'wr-1',
        userId: 'user-1',
        amount: 100,
        status: 'pending',
      });
      mockPrisma.withdrawalRequest.update.mockResolvedValue({
        id: 'wr-1',
        status: 'rejected',
      });
      const result = await service.rejectWithdrawal('wr-1');
      expect(result.status).toBe('rejected');
    });
  });

  describe('changeRole', () => {
    it('should change user role', async () => {
      mockPrisma.user.update.mockResolvedValue({ ...mockUser, role: 'SELLER' });
      const result = await service.changeRole('user-1', 'SELLER');
      expect(result.role).toBe('SELLER');
    });
  });

  describe('batchChangeRole', () => {
    it('should batch update roles', async () => {
      mockPrisma.user.updateMany.mockResolvedValue({ count: 2 });
      await service.batchChangeRole(['user-1', 'user-2'], 'SELLER');
      expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['user-1', 'user-2'] } },
        data: { role: 'SELLER' },
      });
    });
  });

  describe('batchApprove', () => {
    it('should batch approve users', async () => {
      mockPrisma.user.updateMany.mockResolvedValue({ count: 2 });
      await service.batchApprove(['user-1', 'user-2']);
      expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['user-1', 'user-2'] }, isApproved: false },
        data: { isApproved: true },
      });
    });
  });
});
