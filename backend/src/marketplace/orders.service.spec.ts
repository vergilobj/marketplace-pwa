import { Test, TestingModule } from '@nestjs/testing';
import { OrdersService } from './orders.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { PaymentsService } from '../payments/payments.service';
import { EscrowService } from '../payments/escrow.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';

describe('OrdersService', () => {
  let service: OrdersService;
  let _prisma: any;

  const mockProduct = {
    id: 'prod-1',
    title: 'Product',
    price: 1000,
    isActive: true,
    sellerId: 'seller-1',
    seller: { id: 'seller-1', name: 'Seller' },
  };
  const mockOrder = {
    id: 'order-1',
    buyerId: 'buyer-1',
    sellerId: 'seller-1',
    productId: 'prod-1',
    amount: 1000,
    status: 'PENDING',
    escrowStatus: 'NONE',
    escrowAmount: 0,
    referralUserId: null,
    referralBonus: 0,
    platformFee: 0,
    paidAt: null,
    createdAt: new Date(),
    product: mockProduct,
    buyer: { id: 'buyer-1', name: 'Buyer', phone: '+7999' },
    seller: { id: 'seller-1', name: 'Seller', phone: '+7888' },
    referralUser: null,
  };

  const mockPrisma = {
    product: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    deal: {
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
    order: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const mockPayments = {
    createPaymentForOrder: jest.fn().mockResolvedValue({}),
    processSuccessfulPayment: jest.fn().mockResolvedValue({}),
  };
  const mockEscrow = {
    holdForOrder: jest.fn().mockResolvedValue({ held: true, amount: 1000 }),
    releaseEscrow: jest.fn().mockResolvedValue({ released: true }),
    refundEscrow: jest.fn().mockResolvedValue({ refunded: true }),
    // NH9: закрытие рекламного заказа в пользу платформы.
    settleAdSale: jest.fn().mockResolvedValue({ released: true }),
  };
  const mockSettings = {
    getFloat: jest.fn((key: string) => {
      if (key === 'platform_fee_percent') return Promise.resolve(10);
      if (key === 'referral_percent') return Promise.resolve(5);
      return Promise.resolve(0);
    }),
    getInt: jest.fn((_key: string, dflt: number) => Promise.resolve(dflt)),
  };
  const mockNotifications = {
    createNotification: jest.fn().mockResolvedValue({}),
    sendToUser: jest.fn().mockResolvedValue(null),
  };
  const mockAudit = { log: jest.fn().mockResolvedValue({}) };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PaymentsService, useValue: mockPayments },
        { provide: EscrowService, useValue: mockEscrow },
        { provide: SettingsService, useValue: mockSettings },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();
    service = module.get<OrdersService>(OrdersService);
    _prisma = mockPrisma;
    jest.clearAllMocks();
    mockSettings.getFloat.mockImplementation((key: string) => {
      if (key === 'platform_fee_percent') return Promise.resolve(10);
      if (key === 'referral_percent') return Promise.resolve(5);
      return Promise.resolve(0);
    });
    mockSettings.getInt.mockImplementation((_key: string, dflt: number) =>
      Promise.resolve(dflt),
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should throw if product not found', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(null);
      await expect(
        service.create('buyer-1', { productId: 'bad-id' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if product is inactive', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        ...mockProduct,
        isActive: false,
        seller: mockProduct.seller,
      });
      await expect(
        service.create('buyer-1', { productId: 'prod-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if buyer is the seller', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        ...mockProduct,
        sellerId: 'buyer-1',
        seller: mockProduct.seller,
      });
      await expect(
        service.create('buyer-1', { productId: 'prod-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create order and process payment', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        ...mockProduct,
        seller: mockProduct.seller,
      });
      mockPrisma.user.findUnique.mockResolvedValue({ invitedById: 'ref-1' });
      mockPrisma.order.create.mockResolvedValue(mockOrder);
      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);
      const result = await service.create('buyer-1', { productId: 'prod-1' });
      expect(result).toBeDefined();
      expect(mockPayments.createPaymentForOrder).toHaveBeenCalled();
      expect(mockNotifications.createNotification).toHaveBeenCalled();
    });

    it('B8: uses product.price, ignores any client amount field', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        ...mockProduct,
        price: 1000,
        seller: mockProduct.seller,
      });
      mockPrisma.user.findUnique.mockResolvedValue({ invitedById: null });
      mockPrisma.order.create.mockResolvedValue(mockOrder);
      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);

      await service.create('buyer-1', { productId: 'prod-1' });

      expect(mockPrisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amount: 1000 }),
        }),
      );
    });

    it('B8: multiplies product.price by quantity', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        ...mockProduct,
        price: 1000,
        seller: mockProduct.seller,
      });
      mockPrisma.user.findUnique.mockResolvedValue({ invitedById: null });
      mockPrisma.order.create.mockResolvedValue(mockOrder);
      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);

      await service.create('buyer-1', { productId: 'prod-1', quantity: 3 });

      expect(mockPrisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amount: 3000 }),
        }),
      );
    });

    it('§7.4: снапшотит platformFee и referralBonus при создании', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        ...mockProduct,
        price: 1000,
        seller: mockProduct.seller,
      });
      mockPrisma.user.findUnique.mockResolvedValue({ invitedById: 'ref-1' });
      mockPrisma.order.create.mockResolvedValue(mockOrder);
      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);

      await service.create('buyer-1', { productId: 'prod-1' });

      expect(mockPrisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            platformFee: 100, // 10%
            referralBonus: 50, // 5%
            referralUserId: 'ref-1',
          }),
        }),
      );
    });

    it('should set referralUserId from invitedById', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        ...mockProduct,
        seller: mockProduct.seller,
      });
      mockPrisma.user.findUnique.mockResolvedValue({ invitedById: 'ref-1' });
      mockPrisma.order.create.mockResolvedValue({
        ...mockOrder,
        referralUserId: 'ref-1',
      });
      mockPrisma.order.findUnique.mockResolvedValue({
        ...mockOrder,
        referralUserId: 'ref-1',
      });
      await service.create('buyer-1', { productId: 'prod-1' });
      expect(mockPrisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ referralUserId: 'ref-1' }),
        }),
      );
    });
  });

  describe('findById', () => {
    it('should throw NotFoundException', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);
      await expect(
        service.findById('bad-id', 'buyer-1', 'BUYER'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return order for its buyer', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);
      expect(await service.findById('order-1', 'buyer-1', 'BUYER')).toEqual(
        mockOrder,
      );
    });

    it('should throw ForbiddenException for a stranger', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);
      await expect(
        service.findById('order-1', 'stranger', 'BUYER'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('findMyOrders', () => {
    it('should return buyer orders', async () => {
      mockPrisma.order.findMany.mockResolvedValue([mockOrder]);
      const result = await service.findMyOrders('buyer-1', 'BUYER');
      expect(result).toHaveLength(1);
    });

    it('should filter by status', async () => {
      mockPrisma.order.findMany.mockResolvedValue([]);
      await service.findMyOrders('seller-1', 'SELLER', 'PAID');
      expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sellerId: 'seller-1', status: 'PAID' },
        }),
      );
    });
  });

  // ============================================================
  // Матрица переходов (§3)
  // ============================================================

  describe('updateStatus (матрица переходов)', () => {
    it('SELLER не может подтвердить COMPLETED (релиз эскроу)', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        ...mockOrder,
        status: 'SHIPPED',
        escrowStatus: 'HELD',
      });
      await expect(
        service.updateStatus('order-1', 'seller-1', 'SELLER', {
          status: 'COMPLETED',
        } as any),
      ).rejects.toThrow(ForbiddenException);
      expect(mockEscrow.releaseEscrow).not.toHaveBeenCalled();
    });

    it('BUYER не может поставить SHIPPED', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        ...mockOrder,
        status: 'PAID',
        escrowStatus: 'HELD',
      });
      await expect(
        service.updateStatus('order-1', 'buyer-1', 'BUYER', {
          status: 'SHIPPED',
        } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('никто не может поставить PAID через API (даже ADMIN)', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);
      await expect(
        service.updateStatus('order-1', 'admin', 'ADMIN', {
          status: 'PAID',
        } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('SELLER может поставить SHIPPED из PAID', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        ...mockOrder,
        status: 'PAID',
        escrowStatus: 'HELD',
      });
      mockPrisma.order.update.mockResolvedValue({
        ...mockOrder,
        status: 'SHIPPED',
      });
      const result = await service.updateStatus(
        'order-1',
        'seller-1',
        'SELLER',
        { status: 'SHIPPED' } as any,
      );
      expect(result.status).toBe('SHIPPED');
      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'SHIPPED',
            autoCompleteAt: expect.any(Date),
          }),
        }),
      );
    });

    it('BUYER подтверждает COMPLETED из SHIPPED → релиз эскроу', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        ...mockOrder,
        status: 'SHIPPED',
        escrowStatus: 'HELD',
      });
      await service.updateStatus('order-1', 'buyer-1', 'BUYER', {
        status: 'COMPLETED',
      } as any);
      expect(mockEscrow.releaseEscrow).toHaveBeenCalledWith(
        'order-1',
        'buyer_confirmed',
      );
    });

    it('BUYER открывает спор из PAID → DISPUTED, таймер снимается', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        ...mockOrder,
        status: 'PAID',
        escrowStatus: 'HELD',
      });
      mockPrisma.order.update.mockResolvedValue({
        ...mockOrder,
        status: 'DISPUTED',
      });
      const result = await service.updateStatus('order-1', 'buyer-1', 'BUYER', {
        status: 'DISPUTED',
      } as any);
      expect(result.status).toBe('DISPUTED');
      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'DISPUTED',
            autoCompleteAt: null,
          }),
        }),
      );
    });

    it('PAID → CANCELLED запрещено (деньги в эскроу, нужен refund-флоу)', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        ...mockOrder,
        status: 'PAID',
        escrowStatus: 'HELD',
      });
      await expect(
        service.updateStatus('order-1', 'seller-1', 'SELLER', {
          status: 'CANCELLED',
        } as any),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('confirmReceipt', () => {
    it('подтверждает только покупатель', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        ...mockOrder,
        status: 'SHIPPED',
        escrowStatus: 'HELD',
      });
      await expect(
        service.confirmReceipt('order-1', 'seller-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('BUYER подтверждает SHIPPED → releaseEscrow', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        ...mockOrder,
        status: 'SHIPPED',
        escrowStatus: 'HELD',
      });
      await service.confirmReceipt('order-1', 'buyer-1');
      expect(mockEscrow.releaseEscrow).toHaveBeenCalledWith(
        'order-1',
        'buyer_confirmed',
      );
    });

    it('из PAID подтверждать нельзя', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        ...mockOrder,
        status: 'PAID',
        escrowStatus: 'HELD',
      });
      await expect(
        service.confirmReceipt('order-1', 'buyer-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('adminForceStatus', () => {
    it('требует reason', async () => {
      await expect(
        service.adminForceStatus('order-1', { status: 'SHIPPED' } as any, ''),
      ).rejects.toThrow(BadRequestException);
    });

    it('REFUNDED двигает деньги через refundEscrow', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);
      await service.adminForceStatus(
        'order-1',
        { status: 'REFUNDED' } as any,
        'ручной возврат',
      );
      expect(mockEscrow.refundEscrow).toHaveBeenCalledWith(
        'order-1',
        'admin_refund',
        100,
      );
    });
  });

  describe('autoCloseOrders', () => {
    it('(a) PAID неотправленный → refundEscrow', async () => {
      mockPrisma.order.findMany.mockResolvedValueOnce([{ id: 'o1' }]);
      mockPrisma.order.findMany.mockResolvedValueOnce([]);
      // NH9: заказ не рекламный (связи Post нет) → обычный возврат.
      mockPrisma.order.findUnique.mockResolvedValue({ id: 'o1', post: null });
      await service.autoCloseOrders();
      expect(mockEscrow.refundEscrow).toHaveBeenCalledWith(
        'o1',
        'seller_no_ship_timeout',
        100,
      );
      expect(mockEscrow.settleAdSale).not.toHaveBeenCalled();
    });

    it('(b) SHIPPED неподтверждённый → releaseEscrow', async () => {
      mockPrisma.order.findMany.mockResolvedValueOnce([]);
      mockPrisma.order.findMany.mockResolvedValueOnce([{ id: 'o2' }]);
      mockPrisma.order.findUnique.mockResolvedValue({ id: 'o2', post: null });
      await service.autoCloseOrders();
      expect(mockEscrow.releaseEscrow).toHaveBeenCalledWith(
        'o2',
        'auto_timeout',
      );
      expect(mockEscrow.settleAdSale).not.toHaveBeenCalled();
    });

    /**
     * NH9 (КРИТ): рекламный заказ по таймауту «продавец не отгрузил» НЕ
     * возвращается рекламодателю — эскроу закрывается в пользу платформы
     * (услуга оказана: объявление показывается). Признак рекламы — Order.post.
     */
    it('NH9: PAID рекламный заказ → settleAdSale платформе, НЕ refundEscrow', async () => {
      mockPrisma.order.findMany.mockResolvedValueOnce([{ id: 'ad1' }]);
      mockPrisma.order.findMany.mockResolvedValueOnce([]);
      mockPrisma.order.findUnique.mockResolvedValue({
        id: 'ad1',
        post: { id: 'p1', isAd: true },
      });

      await service.autoCloseOrders();

      expect(mockEscrow.settleAdSale).toHaveBeenCalledWith(
        'ad1',
        'settle_ad_sale',
      );
      expect(mockEscrow.refundEscrow).not.toHaveBeenCalled();
      expect(mockEscrow.releaseEscrow).not.toHaveBeenCalled();
    });

    it('NH9: SHIPPED рекламный заказ → settleAdSale, НЕ releaseEscrow', async () => {
      mockPrisma.order.findMany.mockResolvedValueOnce([]);
      mockPrisma.order.findMany.mockResolvedValueOnce([{ id: 'ad2' }]);
      mockPrisma.order.findUnique.mockResolvedValue({
        id: 'ad2',
        post: { id: 'p2', isAd: true },
      });

      await service.autoCloseOrders();

      expect(mockEscrow.settleAdSale).toHaveBeenCalledWith(
        'ad2',
        'settle_ad_sale',
      );
      expect(mockEscrow.releaseEscrow).not.toHaveBeenCalled();
      expect(mockEscrow.refundEscrow).not.toHaveBeenCalled();
    });

    it('NH9: пост есть, но isAd=false → обычный возврат (ложный признак)', async () => {
      mockPrisma.order.findMany.mockResolvedValueOnce([{ id: 'o3' }]);
      mockPrisma.order.findMany.mockResolvedValueOnce([]);
      mockPrisma.order.findUnique.mockResolvedValue({
        id: 'o3',
        post: { id: 'p3', isAd: false },
      });

      await service.autoCloseOrders();

      expect(mockEscrow.refundEscrow).toHaveBeenCalledWith(
        'o3',
        'seller_no_ship_timeout',
        100,
      );
      expect(mockEscrow.settleAdSale).not.toHaveBeenCalled();
    });
  });
});
