import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { PaymodService } from '../payments/paymod.service';
import { LedgerService } from '../payments/ledger.service';

describe('UsersService', () => {
  let service: UsersService;
  let _prisma: any;

  const mockUser = {
    id: 'user-1',
    phone: '+799****2233',
    name: 'Test User',
    role: 'BUYER',
    bonusBalance: 500,
    availableBalance: 0,
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
    ledgerEntry: {
      findMany: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    withdrawalRequest: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn((cb: any) => cb(mockPrisma)),
    // G3: requestWithdrawal берёт pg_advisory_xact_lock внутри транзакции.
    $executeRaw: jest.fn().mockResolvedValue(1),
  };

  const mockAudit = { log: jest.fn().mockResolvedValue({}) };
  const mockNotifications = {
    createNotification: jest.fn().mockResolvedValue({}),
    sendToUser: jest.fn().mockResolvedValue(null),
  };
  const mockSettings = {
    getFloat: jest.fn().mockResolvedValue(0),
  };
  const mockLedger = {
    getBalances: jest.fn(),
    credit: jest.fn().mockResolvedValue({ applied: [], skipped: [] }),
    // NH1: approveWithdrawal проверяет, что каждая проводка РЕАЛЬНО
    // записалась (applied.length === 1, skipped пуст). Мок должен отдавать
    // реалистичный результат, иначе любой вызов упадёт на проверке.
    debit: jest
      .fn()
      .mockImplementation((_tx: any, p: any) =>
        Promise.resolve({ applied: [p.refKey], skipped: [] }),
      ),
  };
  const mockPaymod = {
    payout: jest
      .fn()
      .mockResolvedValue({ tx_hash: '0x0', status: 'submitted' }),
    // D3: read-only проверка состояния выплаты. null — выплаты с таким
    // idempotency_key нет, откат безопасен (поведение по умолчанию).
    getPayout: jest.fn().mockResolvedValue(null),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: SettingsService, useValue: mockSettings },
        { provide: PaymodService, useValue: mockPaymod },
        { provide: LedgerService, useValue: mockLedger },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    _prisma = mockPrisma;
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((cb: any) => cb(mockPrisma));
    mockSettings.getFloat.mockResolvedValue(0);
    mockLedger.getBalances.mockResolvedValue({
      availableBalance: 0,
      bonusBalance: 500,
      escrowBalance: 0,
      pendingEscrow: 0,
      totalWithdrawable: 500,
    });
    mockPaymod.payout.mockResolvedValue({ tx_hash: '0x0', status: 'submitted' });
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

  describe('findAll', () => {
    it('should return paginated users', async () => {
      mockPrisma.user.findMany.mockResolvedValue([mockUser]);
      mockPrisma.user.count.mockResolvedValue(1);
      const result = await service.findAll({ page: 1, limit: 10 });
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  describe('getStats', () => {
    it('should return user stats', async () => {
      mockPrisma.order.count.mockResolvedValueOnce(5).mockResolvedValueOnce(3);
      mockPrisma.order.aggregate.mockResolvedValue({
        _sum: { referralBonus: 150 },
      });
      mockPrisma.user.findUnique.mockResolvedValue({ bonusBalance: 500 });
      mockPrisma.ledgerEntry.aggregate.mockResolvedValue({
        _sum: { amount: 0 },
      });
      const result = await service.getStats('user-1');
      expect(result.boughtCount).toBe(5);
      expect(result.soldCount).toBe(3);
      expect(result.referralEarned).toBe(150);
      expect(result.soldEarned).toBe(0);
    });

    it('§8.2: soldEarned = сумма положительных AVAILABLE-проводок', async () => {
      mockPrisma.order.count.mockResolvedValueOnce(0).mockResolvedValueOnce(7);
      mockPrisma.order.aggregate.mockResolvedValue({
        _sum: { referralBonus: 0 },
      });
      mockPrisma.user.findUnique.mockResolvedValue({ bonusBalance: 0 });
      mockPrisma.ledgerEntry.aggregate.mockResolvedValue({
        _sum: { amount: 4200.5 },
      });

      const result = await service.getStats('seller-1');

      expect(result.soldEarned).toBe(4200.5);
      // Запрос считает только зачисления и только по AVAILABLE.
      expect(mockPrisma.ledgerEntry.aggregate).toHaveBeenCalledWith({
        where: {
          userId: 'seller-1',
          account: 'AVAILABLE',
          amount: { gt: 0 },
        },
        _sum: { amount: true },
      });
    });
  });

  describe('getBalance (§4.6)', () => {
    it('returns available + bonus + pendingEscrow + totalWithdrawable', async () => {
      mockLedger.getBalances.mockResolvedValue({
        availableBalance: 850,
        bonusBalance: 50,
        escrowBalance: 0,
        pendingEscrow: 300,
        totalWithdrawable: 900,
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        availableBalance: 850,
        bonusBalance: 50,
      });
      const result = await service.getBalance('user-1');
      expect(result.availableBalance).toBe(850);
      expect(result.bonusBalance).toBe(50);
      expect(result.pendingEscrow).toBe(300);
      expect(result.totalWithdrawable).toBe(900);
    });
  });

  describe('getLedger (§8.2)', () => {
    it('returns items and null cursor when no more pages', async () => {
      mockPrisma.ledgerEntry.findMany.mockResolvedValue([
        { id: 'l1', amount: 10, account: 'AVAILABLE' },
        { id: 'l2', amount: -5, account: 'REFERRAL' },
      ]);
      const result = await service.getLedger('user-1', { limit: 20 });
      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBeNull();
      expect(mockPrisma.ledgerEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1' }, take: 21 }),
      );
    });

    it('returns nextCursor when there is an extra row', async () => {
      mockPrisma.ledgerEntry.findMany.mockResolvedValue([
        { id: 'l1' },
        { id: 'l2' },
        { id: 'l3' },
      ]);
      const result = await service.getLedger('user-1', { limit: 2 });
      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBe('l2');
    });

    it('applies cursor with skip 1', async () => {
      mockPrisma.ledgerEntry.findMany.mockResolvedValue([{ id: 'l3' }]);
      await service.getLedger('user-1', { limit: 2, cursor: 'l2' });
      expect(mockPrisma.ledgerEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: { id: 'l2' },
          skip: 1,
        }),
      );
    });
  });

  describe('requestWithdrawal (§5.2)', () => {
    it('should throw if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.requestWithdrawal('bad-id', 100)).rejects.toThrow(
        'Пользователь не найден',
      );
    });

    it('should throw if amount is not positive', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      await expect(service.requestWithdrawal('user-1', 0)).rejects.toThrow(
        'Amount must be positive',
      );
    });

    it('should throw if below withdrawal_min_amount', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockSettings.getFloat.mockImplementation((key: string) =>
        Promise.resolve(key === 'withdrawal_min_amount' ? 10 : 0),
      );
      await expect(service.requestWithdrawal('user-1', 5)).rejects.toThrow(
        'Минимальная сумма вывода',
      );
    });

    it('should throw if insufficient balance', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.withdrawalRequest.findMany.mockResolvedValue([]);
      mockLedger.getBalances.mockResolvedValue({
        availableBalance: 0,
        bonusBalance: 100,
        escrowBalance: 0,
        pendingEscrow: 0,
        totalWithdrawable: 100,
      });
      await expect(service.requestWithdrawal('user-1', 1000)).rejects.toThrow(
        'Insufficient balance',
      );
    });

    it('should create withdrawal request from combined balance', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.withdrawalRequest.findMany.mockResolvedValue([]);
      mockLedger.getBalances.mockResolvedValue({
        availableBalance: 300,
        bonusBalance: 200,
        escrowBalance: 0,
        pendingEscrow: 0,
        totalWithdrawable: 500,
      });
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
      mockLedger.getBalances.mockResolvedValue({
        availableBalance: 0,
        bonusBalance: 500,
        escrowBalance: 0,
        pendingEscrow: 0,
        totalWithdrawable: 500,
      });
      await expect(service.requestWithdrawal('user-1', 100)).rejects.toThrow(
        'Insufficient balance',
      );
    });
  });

  describe('approveWithdrawal (§5.2)', () => {
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

    it('адрес проверяется ДО списания: нет адреса → FAILED, без debit', async () => {
      mockPrisma.withdrawalRequest.findUnique.mockResolvedValue({
        id: 'wr-1',
        userId: 'user-1',
        amount: 100,
        status: 'pending',
        toAddress: null,
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        bonusBalance: 500,
        walletAddress: null,
      });
      await expect(service.approveWithdrawal('wr-1')).rejects.toThrow(
        'No valid wallet address',
      );
      expect(mockLedger.debit).not.toHaveBeenCalled();
    });

    it('успех: списание через ledger + SUBMITTED', async () => {
      mockPrisma.withdrawalRequest.findUnique.mockResolvedValue({
        id: 'wr-1',
        userId: 'user-1',
        amount: 100,
        status: 'pending',
        toAddress: '0x' + 'a'.repeat(40),
        payoutAttempts: 0,
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        bonusBalance: 500,
        walletAddress: null,
      });
      mockLedger.getBalances.mockResolvedValue({
        availableBalance: 500,
        bonusBalance: 0,
        escrowBalance: 0,
        pendingEscrow: 0,
        totalWithdrawable: 500,
      });
      mockPrisma.withdrawalRequest.update.mockResolvedValue({
        id: 'wr-1',
        status: 'approved',
        payoutStatus: 'SUBMITTED',
      });
      await service.approveWithdrawal('wr-1');
      expect(mockLedger.debit).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          account: 'AVAILABLE',
          amount: 100,
          // NH1: refKey дебета ОБЯЗАН содержать номер попытки. Без него
          // повторное одобрение после reversal молча пропускалось
          // (skipDuplicates) и выплата уходила без списания.
          refKey: 'withdrawal_debit:wr-1:1:AVAILABLE',
        }),
      );
    });

    it('FAILED payout: компенсация + заявка обратно в pending', async () => {
      mockPrisma.withdrawalRequest.findUnique.mockResolvedValue({
        id: 'wr-1',
        userId: 'user-1',
        amount: 100,
        status: 'pending',
        toAddress: '0x' + 'a'.repeat(40),
        payoutAttempts: 0,
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        bonusBalance: 500,
        walletAddress: null,
      });
      mockLedger.getBalances.mockResolvedValue({
        availableBalance: 500,
        bonusBalance: 0,
        escrowBalance: 0,
        pendingEscrow: 0,
        totalWithdrawable: 500,
      });
      mockPaymod.payout.mockRejectedValue(new Error('network down'));
      mockPrisma.withdrawalRequest.findUniqueOrThrow.mockResolvedValue({
        id: 'wr-1',
        status: 'pending',
        payoutStatus: 'FAILED',
        payoutAttempts: 1,
      });

      const result = await service.approveWithdrawal('wr-1');

      // Компенсирующая проводка с refKey включающим attempt.
      expect(mockLedger.credit).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          refKey: 'withdrawal_reversal:wr-1:1:AVAILABLE',
          amount: 100,
        }),
      );
      expect(result.status).toBe('pending');
      expect(result.payoutStatus).toBe('FAILED');
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