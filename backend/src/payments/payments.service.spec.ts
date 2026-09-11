import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NowPaymentsProvider } from './nowpayments.provider';
import { PaymodProvider } from './paymod.provider';
import { PaymodService } from './paymod.service';
import { LedgerService } from './ledger.service';
import { EscrowService } from './escrow.service';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: any;

  const mockOrder = {
    id: 'order-1',
    amount: 1000,
    status: 'PENDING',
    productId: 'prod-1',
    platformFee: 100,
    referralBonus: 50,
    referralUserId: null,
    transactionId: null,
    buyer: { id: 'buyer-1', name: 'Buyer' },
    seller: { id: 'seller-1', name: 'Seller' },
    referralUser: null,
  };

  const mockPrisma = {
    order: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    transaction: {
      create: jest.fn(),
      createMany: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    user: {
      update: jest.fn(),
    },
    withdrawalRequest: {
      findMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    ledgerEntry: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn((fn: any) => fn(mockPrisma)),
  };
  const mockSettings = {
    get: jest.fn().mockResolvedValue('paymod'),
    getFloat: jest.fn((key: string) => {
      if (key === 'platform_fee_percent') return Promise.resolve(10);
      if (key === 'referral_percent') return Promise.resolve(5);
      return Promise.resolve(0);
    }),
  };
  const mockNotifications = {
    createNotification: jest.fn().mockResolvedValue({}),
    sendToUser: jest.fn().mockResolvedValue(null),
  };

  const mockNowPayments = {
    createPayment: jest.fn().mockResolvedValue({
      success: true,
      transactionId: 'np-tx-1',
      status: 'pending',
      raw: { invoice_url: 'https://nowpayments.io/invoice/123' },
    }),
  };

  const mockPaymod = {
    createPayment: jest.fn().mockResolvedValue({
      success: true,
      transactionId: 'mp-txn-order-1',
      status: 'pending',
      raw: { deposit_address: '0xabc', client_ref: 'mp-txn-order-1' },
    }),
  };

  const mockEscrow = {
    holdForOrder: jest.fn().mockResolvedValue({ held: true, amount: 1000 }),
    releaseEscrow: jest.fn(),
    refundEscrow: jest.fn(),
  };

  const mockPaymodService = {
    getTxStatus: jest.fn(),
  };

  const mockLedger = {
    credit: jest.fn().mockResolvedValue({ applied: [], skipped: [] }),
    debit: jest.fn().mockResolvedValue({ applied: [], skipped: [] }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SettingsService, useValue: mockSettings },
        { provide: NowPaymentsProvider, useValue: mockNowPayments },
        { provide: PaymodProvider, useValue: mockPaymod },
        { provide: PaymodService, useValue: mockPaymodService },
        { provide: LedgerService, useValue: mockLedger },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: EscrowService, useValue: mockEscrow },
      ],
    }).compile();
    service = module.get<PaymentsService>(PaymentsService);
    prisma = mockPrisma;
    jest.clearAllMocks();
    mockSettings.get.mockResolvedValue('paymod');
    mockPaymod.createPayment.mockResolvedValue({
      success: true,
      transactionId: 'mp-txn-order-1',
      status: 'pending',
      raw: { deposit_address: '0xabc', client_ref: 'mp-txn-order-1' },
    });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createPaymentForOrder', () => {
    it('should throw if order not found', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);
      await expect(service.createPaymentForOrder('bad-id')).rejects.toThrow(
        'Заказ не найден',
      );
    });

    it('should throw if order already paid', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        ...mockOrder,
        status: 'PAID',
      });
      await expect(service.createPaymentForOrder('order-1')).rejects.toThrow(
        'Order already paid or cancelled',
      );
    });

    it('§7.4: НЕ пересчитывает комиссии (снапшот берётся из Order)', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);
      mockPrisma.transaction.create.mockResolvedValue({});
      await service.createPaymentForOrder('order-1');
      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });

    it('создаёт транзакцию с expectedAmountRaw и tokenDecimals', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);
      mockPrisma.transaction.create.mockResolvedValue({});
      const result = await service.createPaymentForOrder('order-1');
      expect(result).toHaveProperty('depositAddress');
      expect(mockPrisma.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            expectedAmountRaw: expect.any(String),
            tokenDecimals: 18,
          }),
        }),
      );
    });
  });

  describe('processSuccessfulPayment (§4.2, этап 3)', () => {
    it('ничего не делает, если guard не захватил заказ (уже не PENDING)', async () => {
      mockPrisma.order.updateMany.mockResolvedValue({ count: 0 });
      await service.processSuccessfulPayment('order-1');
      expect(mockEscrow.holdForOrder).not.toHaveBeenCalled();
    });

    it('PENDING → PAID + escrow hold (split НЕ исполняется)', async () => {
      mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });
      mockEscrow.holdForOrder.mockResolvedValue({ held: true, amount: 1000 });
      await service.processSuccessfulPayment('order-1');

      expect(mockPrisma.order.updateMany).toHaveBeenCalledWith({
        where: { id: 'order-1', status: 'PENDING' },
        data: expect.objectContaining({ status: 'PAID' }),
      });
      expect(mockEscrow.holdForOrder).toHaveBeenCalledWith('order-1');
      // Сплит больше НЕ создаётся и бонус НЕ начисляется на этом шаге.
      expect(mockPrisma.transaction.createMany).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('идемпотентен: повторный вызов не холдирует второй раз', async () => {
      mockPrisma.order.updateMany.mockResolvedValueOnce({ count: 1 });
      mockEscrow.holdForOrder.mockResolvedValue({ held: true, amount: 1000 });
      await service.processSuccessfulPayment('order-1');

      mockPrisma.order.updateMany.mockResolvedValueOnce({ count: 0 });
      await service.processSuccessfulPayment('order-1');

      expect(mockEscrow.holdForOrder).toHaveBeenCalledTimes(1);
    });
  });

  describe('reconcilePayouts (D3)', () => {
    it('CONFIRMED в сети → status=paid, payoutStatus=CONFIRMED', async () => {
      mockPrisma.withdrawalRequest.findMany.mockResolvedValue([
        {
          id: 'wr-1',
          userId: 'user-1',
          amount: 100,
          status: 'approved',
          payoutStatus: 'SUBMITTED',
          payoutTxHash: '0xtx1',
          payoutAttempts: 1,
        },
      ]);
      mockPaymodService.getTxStatus.mockResolvedValue({
        tx_hash: '0xtx1',
        status: 'CONFIRMED',
        confirmations: 12,
      });
      mockPrisma.withdrawalRequest.update.mockResolvedValue({});

      const result = await service.reconcilePayouts();

      expect(result.confirmed).toBe(1);
      expect(mockPrisma.withdrawalRequest.update).toHaveBeenCalledWith({
        where: { id: 'wr-1' },
        data: { status: 'paid', payoutStatus: 'CONFIRMED' },
      });
    });

    it('FAILED в сети → reversal + заявка обратно в pending', async () => {
      mockPrisma.withdrawalRequest.findMany.mockResolvedValue([
        {
          id: 'wr-2',
          userId: 'user-2',
          amount: 50,
          status: 'approved',
          payoutStatus: 'SUBMITTED',
          payoutTxHash: '0xtx2',
          payoutAttempts: 1,
        },
      ]);
      mockPaymodService.getTxStatus.mockResolvedValue({
        tx_hash: '0xtx2',
        status: 'failed',
        confirmations: 0,
      });
      // Списание по заявке было: 50 с AVAILABLE.
      // NH4: номер попытки берётся из refKey дебета, поэтому он обязан быть
      // в моке — это тот же источник истины, что и в проде.
      mockPrisma.ledgerEntry.findMany.mockResolvedValue([
        {
          account: 'AVAILABLE',
          amount: -50,
          refKey: 'withdrawal_debit:wr-2:1:AVAILABLE',
        },
      ]);
      mockPrisma.withdrawalRequest.findUniqueOrThrow.mockResolvedValue({
        id: 'wr-2',
        status: 'approved',
        payoutAttempts: 1,
      });
      mockPrisma.withdrawalRequest.update.mockResolvedValue({});

      const result = await service.reconcilePayouts();

      expect(result.failed).toBe(1);
      // Возврат средств покупателю через ledger.
      expect(mockLedger.credit).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          account: 'AVAILABLE',
          amount: 50,
          type: 'withdrawal_reversal',
        }),
      );
    });

    it('PENDING в сети → ничего не меняем, ждём следующий тик', async () => {
      mockPrisma.withdrawalRequest.findMany.mockResolvedValue([
        {
          id: 'wr-3',
          userId: 'user-3',
          amount: 10,
          status: 'approved',
          payoutStatus: 'SUBMITTED',
          payoutTxHash: '0xtx3',
          payoutAttempts: 1,
        },
      ]);
      mockPaymodService.getTxStatus.mockResolvedValue({
        tx_hash: '0xtx3',
        status: 'pending',
        confirmations: 0,
      });

      const result = await service.reconcilePayouts();

      expect(result.confirmed).toBe(0);
      expect(result.failed).toBe(0);
      expect(mockPrisma.withdrawalRequest.update).not.toHaveBeenCalled();
    });
  });

  describe('getAllTransactions', () => {
    it('should return paginated transactions', async () => {
      mockPrisma.transaction.findMany.mockResolvedValue([
        { id: 'tx-1', amount: 1000 },
      ]);
      mockPrisma.transaction.count.mockResolvedValue(1);
      const result = await service.getAllTransactions();
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should filter by type', async () => {
      mockPrisma.transaction.findMany.mockResolvedValue([]);
      mockPrisma.transaction.count.mockResolvedValue(0);
      await service.getAllTransactions({ type: 'payment' });
      expect(mockPrisma.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { type: 'payment' } }),
      );
    });
  });
});