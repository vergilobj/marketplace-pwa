import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { NotFoundException } from '@nestjs/common';

describe('UsersController', () => {
  let controller: UsersController;
  let service: any;

  const mockUser = {
    id: 'user-1', phone: '+7999', name: 'Test', role: 'BUYER',
    passwordHash: 'hash', bonusBalance: 100, isApproved: true, referralCode: 'ABC',
  };

  const mockUsersService = {
    findById: jest.fn(),
    findAll: jest.fn(),
    updateProfile: jest.fn(),
    getReferrals: jest.fn(),
    exportUsers: jest.fn(),
    getBalance: jest.fn(),
    requestWithdrawal: jest.fn(),
    getMyWithdrawalRequests: jest.fn(),
    getAllWithdrawalRequests: jest.fn(),
    approveWithdrawal: jest.fn(),
    rejectWithdrawal: jest.fn(),
    changeRole: jest.fn(),
    getStats: jest.fn(),
    batchChangeRole: jest.fn(),
    batchApprove: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: mockUsersService }],
    }).compile();
    controller = module.get<UsersController>(UsersController);
    service = mockUsersService;
    jest.clearAllMocks();
  });

  it('should be defined', () => { expect(controller).toBeDefined(); });

  describe('getProfile', () => {
    it('should return user without passwordHash', async () => {
      service.findById.mockResolvedValue(mockUser);
      const result = await controller.getProfile({ user: { userId: 'user-1' } });
      expect(result).not.toHaveProperty('passwordHash');
      expect(result.phone).toBe('+7999');
    });

    it('should throw NotFoundException', async () => {
      service.findById.mockResolvedValue(null);
      await expect(controller.getProfile({ user: { userId: 'bad' } })).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('should return paginated users', async () => {
      service.findAll.mockResolvedValue({ items: [], total: 0 });
      const result = await controller.findAll('1', '10', 'search');
      expect(result).toHaveProperty('items');
      expect(service.findAll).toHaveBeenCalledWith({ page: 1, limit: 10, search: 'search' });
    });
  });

  describe('updateProfile', () => {
    it('should update user profile', async () => {
      service.updateProfile.mockResolvedValue(mockUser);
      const result = await controller.updateProfile({ user: { userId: 'user-1' } }, { name: 'New' });
      expect(result).toBeDefined();
    });
  });

  describe('getBalance', () => {
    it('should return balance', async () => {
      service.getBalance.mockResolvedValue({ balance: 500 });
      const result = await controller.getBalance({ user: { userId: 'user-1' } });
      expect(result.balance).toBe(500);
    });
  });

  describe('requestWithdrawal', () => {
    it('should create withdrawal request', async () => {
      service.requestWithdrawal.mockResolvedValue({ id: 'wr-1', amount: 100 });
      const result = await controller.requestWithdrawal({ user: { userId: 'user-1' } }, 100);
      expect(result.id).toBe('wr-1');
    });
  });

  describe('exportUsers', () => {
    it('should return CSV', async () => {
      service.exportUsers.mockResolvedValue([mockUser]);
      const result = await controller.exportUsers();
      expect(result).toContain('ID,Phone,Name');
      expect(result).toContain('user-1');
    });
  });

  describe('changeRole', () => {
    it('should change user role', async () => {
      service.changeRole.mockResolvedValue({ ...mockUser, role: 'SELLER' });
      await controller.changeRole('user-1', 'SELLER');
      expect(service.changeRole).toHaveBeenCalledWith('user-1', 'SELLER');
    });
  });

  describe('batchChangeRole', () => {
    it('should batch update roles', async () => {
      await controller.batchChangeRole({ userIds: ['u1', 'u2'], role: 'SELLER' });
      expect(service.batchChangeRole).toHaveBeenCalledWith(['u1', 'u2'], 'SELLER');
    });
  });

  describe('batchApprove', () => {
    it('should batch approve', async () => {
      await controller.batchApprove({ userIds: ['u1', 'u2'] });
      expect(service.batchApprove).toHaveBeenCalledWith(['u1', 'u2']);
    });
  });

  describe('approveWithdrawal', () => {
    it('should approve withdrawal', async () => {
      service.approveWithdrawal.mockResolvedValue({ id: 'wr-1', status: 'approved' });
      await controller.approveWithdrawal('wr-1');
      expect(service.approveWithdrawal).toHaveBeenCalledWith('wr-1');
    });
  });

  describe('rejectWithdrawal', () => {
    it('should reject withdrawal', async () => {
      service.rejectWithdrawal.mockResolvedValue({ id: 'wr-1', status: 'rejected' });
      await controller.rejectWithdrawal('wr-1');
      expect(service.rejectWithdrawal).toHaveBeenCalledWith('wr-1');
    });
  });
});
