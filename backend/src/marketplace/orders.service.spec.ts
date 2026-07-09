import { Test, TestingModule } from '@nestjs/testing';
import { OrdersService } from './orders.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';

describe('OrdersService', () => {
  let service: OrdersService;
  let prisma: any;

  const mockProduct = {
    id: 'prod-1', title: 'Product', price: 1000, isActive: true,
    sellerId: 'seller-1', seller: { id: 'seller-1', name: 'Seller' },
  };
  const mockOrder = {
    id: 'order-1', buyerId: 'buyer-1', sellerId: 'seller-1', productId: 'prod-1',
    amount: 1000, status: 'PENDING', referralUserId: null, referralBonus: 0,
    platformFee: 0, paidAt: null, createdAt: new Date(),
    product: mockProduct,
    buyer: { id: 'buyer-1', name: 'Buyer', phone: '+7999' },
    seller: { id: 'seller-1', name: 'Seller', phone: '+7888' },
    referralUser: null,
  };

  const mockPrisma = {
    product: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    order: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  };
  const mockPayments = {
    createPaymentForOrder: jest.fn().mockResolvedValue({}),
    processSuccessfulPayment: jest.fn().mockResolvedValue({}),
  };
  const mockNotifications = {
    createNotification: jest.fn().mockResolvedValue({}),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PaymentsService, useValue: mockPayments },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();
    service = module.get<OrdersService>(OrdersService);
    prisma = mockPrisma;
    jest.clearAllMocks();
  });

  it('should be defined', () => { expect(service).toBeDefined(); });

  describe('create', () => {
    it('should throw if product not found', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(null);
      await expect(service.create('buyer-1', { productId: 'bad-id' })).rejects.toThrow(BadRequestException);
    });

    it('should throw if product is inactive', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({ ...mockProduct, isActive: false, seller: mockProduct.seller });
      await expect(service.create('buyer-1', { productId: 'prod-1' })).rejects.toThrow(BadRequestException);
    });

    it('should create order and process payment', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({ ...mockProduct, seller: mockProduct.seller });
      mockPrisma.user.findUnique.mockResolvedValue({ invitedById: 'ref-1' });
      mockPrisma.order.create.mockResolvedValue(mockOrder);
      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);
      const result = await service.create('buyer-1', { productId: 'prod-1' });
      expect(result).toBeDefined();
      expect(mockPayments.createPaymentForOrder).toHaveBeenCalled();
      expect(mockNotifications.createNotification).toHaveBeenCalled();
    });

    it('should set referralUserId from invitedById', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({ ...mockProduct, seller: mockProduct.seller });
      mockPrisma.user.findUnique.mockResolvedValue({ invitedById: 'ref-1' });
      mockPrisma.order.create.mockResolvedValue({ ...mockOrder, referralUserId: 'ref-1' });
      mockPrisma.order.findUnique.mockResolvedValue({ ...mockOrder, referralUserId: 'ref-1' });
      await service.create('buyer-1', { productId: 'prod-1' });
      expect(mockPrisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ referralUserId: 'ref-1' }) }),
      );
    });
  });

  describe('findById', () => {
    it('should throw NotFoundException', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);
      await expect(service.findById('bad-id')).rejects.toThrow(NotFoundException);
    });

    it('should return order', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);
      expect(await service.findById('order-1')).toEqual(mockOrder);
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
        expect.objectContaining({ where: { sellerId: 'seller-1', status: 'PAID' } }),
      );
    });
  });

  describe('updateStatus', () => {
    it('should throw ForbiddenException if seller not owner', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);
      await expect(service.updateStatus('order-1', 'other-seller', 'SELLER', { status: 'SHIPPED' }))
        .rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException if buyer not owner', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);
      await expect(service.updateStatus('order-1', 'other-buyer', 'BUYER', { status: 'COMPLETED' }))
        .rejects.toThrow(ForbiddenException);
    });

    it('should allow admin to mark as PAID', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);
      mockPrisma.order.update.mockResolvedValue({ ...mockOrder, status: 'PAID' });
      const result = await service.updateStatus('order-1', 'admin', 'ADMIN', { status: 'PAID' });
      expect(result.status).toBe('PAID');
    });

    it('should reject non-admin marking as PAID', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);
      await expect(service.updateStatus('order-1', 'seller-1', 'SELLER', { status: 'PAID' }))
        .rejects.toThrow(ForbiddenException);
    });

    it('should allow seller to mark as SHIPPED', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);
      mockPrisma.order.update.mockResolvedValue({ ...mockOrder, status: 'SHIPPED' });
      const result = await service.updateStatus('order-1', 'seller-1', 'SELLER', { status: 'SHIPPED' });
      expect(result.status).toBe('SHIPPED');
    });
  });
});
