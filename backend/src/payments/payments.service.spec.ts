import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NowPaymentsProvider } from './nowpayments.provider';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: any;

  const mockOrder = {
    id: 'order-1',
    amount: 1000,
    status: 'PENDING',
    productId: 'prod-1',
    platformFee: 0,
    referralBonus: 0,
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
  };
  const mockSettings = {
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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SettingsService, useValue: mockSettings },
        { provide: NowPaymentsProvider, useValue: mockNowPayments },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();
    service = module.get<PaymentsService>(PaymentsService);
    prisma = mockPrisma;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createPaymentForOrder', () => {
    it('should throw if order not found', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);
      await expect(service.createPaymentForOrder('bad-id')).rejects.toThrow(
        'Order not found',
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

    it('should calculate platform fees for product orders', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);
      mockPrisma.order.update.mockResolvedValue({});
      mockPrisma.transaction.create.mockResolvedValue({});
      await service.createPaymentForOrder('order-1');
      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            platformFee: 100,
            referralBonus: 50,
          }),
        }),
      );
    });

    it('should create transaction and return invoice url', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);
      mockPrisma.order.update.mockResolvedValue({});
      mockPrisma.transaction.create.mockResolvedValue({});
      const result = await service.createPaymentForOrder('order-1');
      expect(result).toHaveProperty('invoiceUrl');
      expect(result).toHaveProperty('transactionId');
      expect(mockPrisma.transaction.create).toHaveBeenCalled();
    });
  });

  describe('processSuccessfulPayment', () => {
    it('should do nothing if order not found', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);
      await service.processSuccessfulPayment('bad-id');
      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });

    it('should do nothing if order not PENDING', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        ...mockOrder,
        status: 'PAID',
      });
      await service.processSuccessfulPayment('order-1');
      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });

    it('should update order status to PAID and create split transactions', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        ...mockOrder,
        platformFee: 100,
        referralBonus: 50,
        referralUserId: 'ref-1',
        buyer: { id: 'buyer-1' },
        seller: { id: 'seller-1' },
        referralUser: { id: 'ref-1' },
      });
      mockPrisma.order.update.mockResolvedValue({});
      mockPrisma.transaction.createMany.mockResolvedValue({});
      mockPrisma.user.update.mockResolvedValue({});
      await service.processSuccessfulPayment('order-1');
      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PAID' }),
        }),
      );
      expect(mockPrisma.transaction.createMany).toHaveBeenCalled();
    });

    it('should credit referral bonus', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        ...mockOrder,
        platformFee: 100,
        referralBonus: 50,
        referralUserId: 'ref-1',
        buyer: { id: 'buyer-1' },
        seller: { id: 'seller-1' },
        referralUser: { id: 'ref-1' },
      });
      mockPrisma.order.update.mockResolvedValue({});
      mockPrisma.transaction.createMany.mockResolvedValue({});
      mockPrisma.user.update.mockResolvedValue({});
      await service.processSuccessfulPayment('order-1');
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'ref-1' },
        data: { bonusBalance: { increment: 50 } },
      });
      expect(mockNotifications.createNotification).toHaveBeenCalled();
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
