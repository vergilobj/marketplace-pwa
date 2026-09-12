import { Test, TestingModule } from '@nestjs/testing';
import { PostsService } from './posts.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { PaymentsService } from '../payments/payments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ModerationService } from '../moderation/moderation.service';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';

describe('PostsService', () => {
  let service: PostsService;
  let _prisma: any;

  const mockPost = {
    id: 'post-1',
    title: 'Test Post',
    content: 'Content',
    isAd: false,
    isHidden: false,
    isPinned: false,
    adExpireDate: null,
    authorId: 'author-1',
    author: { id: 'author-1', name: 'Author' },
    createdAt: new Date(),
  };

  const mockPrisma = {
    post: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    user: { findFirst: jest.fn() },
    order: { create: jest.fn(), findUnique: jest.fn() },
    // Срок рекламы (adDaysForOrder) читает payload платежа; в юнит-тестах
    // моков нет — падаем в фолбэк Order.amount / ad_price.
    transaction: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
    like: { deleteMany: jest.fn() },
    comment: { deleteMany: jest.fn() },
  };
  const mockSettings = {
    getFloat: jest.fn().mockResolvedValue(5000),
    getInt: jest.fn().mockResolvedValue(5),
  };
  const mockPayments = {
    createPaymentForOrder: jest.fn().mockResolvedValue({}),
    processSuccessfulPayment: jest.fn().mockResolvedValue({}),
  };
  const mockNotifications = {
    createNotification: jest.fn().mockResolvedValue({}),
  };
  const mockModeration = {
    moderate: jest.fn().mockResolvedValue({ verdict: 'allow' }),
  };
  const mockAudit = { log: jest.fn().mockResolvedValue({}) };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SettingsService, useValue: mockSettings },
        { provide: PaymentsService, useValue: mockPayments },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: ModerationService, useValue: mockModeration },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();
    service = module.get<PostsService>(PostsService);
    _prisma = mockPrisma;
    jest.clearAllMocks();
    mockModeration.moderate.mockResolvedValue({ verdict: 'allow' });
    mockSettings.getFloat.mockResolvedValue(5000);
    mockSettings.getInt.mockResolvedValue(5);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a post', async () => {
      const dto = { title: 'New Post', content: 'Body' };
      mockPrisma.post.create.mockResolvedValue(mockPost);
      const result = await service.create('author-1', dto);
      expect(result).toEqual(mockPost);
    });
  });

  describe('createAd', () => {
    it('should throw if no admin found', async () => {
      mockPrisma.post.create.mockResolvedValue(mockPost);
      mockPrisma.user.findFirst.mockResolvedValue(null);
      await expect(
        service.createAd('seller-1', {
          title: 'Ad',
          content: '',
          link: '',
          days: 7,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    /**
     * NH5-ad (крит): рекламный заказ НЕ подтверждается без депозита.
     * Раньше createAd звал processSuccessfulPayment → Order сразу PAID +
     * escrowStatus HELD без единого цента в блокчейне, реклама активировалась,
     * а через 5 дней autoCloseOrders возвращал «покупателю» escrowAmount на
     * AVAILABLE → вывод в BSC. Теперь заказ остаётся PENDING/escrow NONE,
     * платёж создаётся, реклама не активируется.
     */
    it('NH5-ad: создаёт PENDING-заказ и НЕ подтверждает оплату без депозита', async () => {
      mockPrisma.post.create.mockResolvedValue({ ...mockPost, isAd: true });
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'admin-1',
        role: 'ADMIN',
      });
      mockPrisma.order.create.mockResolvedValue({
        id: 'order-1',
        amount: 35000,
      });
      mockPrisma.post.update.mockResolvedValue({});
      mockPrisma.post.findUnique.mockResolvedValue({
        ...mockPost,
        isAd: true,
        order: { id: 'order-1' },
      });

      await service.createAd('seller-1', {
        title: 'Ad',
        content: '',
        link: '',
        days: 7,
      });

      // Заказ создан неподтверждённым.
      expect(mockPrisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PENDING' }),
        }),
      );
      // Платёж (депозит-адрес) создан — оплата пойдёт через webhook.
      expect(mockPayments.createPaymentForOrder).toHaveBeenCalledWith(
        'order-1',
      );
      // ГЛАВНОЕ: оплата НЕ подтверждается в HTTP-хендлере.
      expect(mockPayments.processSuccessfulPayment).not.toHaveBeenCalled();
      // Реклама НЕ активирована: post.update звался только для orderId.
      expect(mockPrisma.post.update).toHaveBeenCalledTimes(1);
      expect(mockPrisma.post.update).toHaveBeenCalledWith({
        where: { id: 'post-1' },
        data: { orderId: 'order-1' },
      });
    });
  });

  describe('activateAdForOrder (NH5-ad)', () => {
    it('НЕ активирует рекламу, если заказ не PAID/HELD (нет депозита)', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: 'order-1',
        status: 'PENDING',
        escrowStatus: 'NONE',
        escrowHeldAt: null,
      });
      const result = await service.activateAdForOrder('order-1');
      expect(result).toBe(false);
      expect(mockPrisma.post.update).not.toHaveBeenCalled();
    });

    it('активирует рекламу только при PAID + HELD (депозит подтверждён)', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: 'order-1',
        status: 'PAID',
        escrowStatus: 'HELD',
        escrowHeldAt: new Date(),
      });
      mockPrisma.post.findUnique.mockResolvedValue({
        id: 'post-1',
        isPinned: false,
        adExpireDate: null,
      });
      mockPrisma.post.update.mockResolvedValue({});
      const result = await service.activateAdForOrder('order-1');
      expect(result).toBe(true);
      expect(mockPrisma.post.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'post-1' },
          data: expect.objectContaining({ isPinned: true }),
        }),
      );
    });

    it('не трогает обычный (не рекламный) заказ', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: 'order-1',
        status: 'PAID',
        escrowStatus: 'HELD',
        escrowHeldAt: new Date(),
      });
      mockPrisma.post.findUnique.mockResolvedValue(null);
      const result = await service.activateAdForOrder('order-1');
      expect(result).toBe(false);
    });
  });

  describe('findAll', () => {
    it('should return visible posts', async () => {
      mockPrisma.post.findMany.mockResolvedValue([mockPost]);
      const result = await service.findAll({});
      expect(result.items).toHaveLength(1);
    });
  });

  describe('findById', () => {
    it('should throw NotFoundException', async () => {
      mockPrisma.post.findUnique.mockResolvedValue(null);
      await expect(service.findById('bad-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('delete', () => {
    it('should delete post and cascade likes/comments', async () => {
      mockPrisma.like.deleteMany.mockResolvedValue({});
      mockPrisma.comment.deleteMany.mockResolvedValue({});
      mockPrisma.post.delete.mockResolvedValue(mockPost);
      await service.delete('post-1');
      expect(mockPrisma.like.deleteMany).toHaveBeenCalled();
      expect(mockPrisma.comment.deleteMany).toHaveBeenCalled();
    });
  });

  describe('getFeed', () => {
    it('should return feed with like counts', async () => {
      mockPrisma.post.findMany.mockResolvedValue([
        { ...mockPost, _count: { likes: 5, comments: 3 }, likes: [] },
      ]);
      const result = await service.getFeed({ userId: 'user-1' });
      expect(result.items[0].likeCount).toBe(5);
      expect(result.items[0].commentCount).toBe(3);
    });

    it('should return feed without userId', async () => {
      mockPrisma.post.findMany.mockResolvedValue([
        { ...mockPost, _count: { likes: 0, comments: 0 }, likes: false },
      ]);
      const result = await service.getFeed({});
      expect(result.items[0].likeCount).toBe(0);
    });
  });

  describe('toggleVisibility', () => {
    it('should toggle isHidden', async () => {
      mockPrisma.post.findUnique.mockResolvedValue(mockPost);
      mockPrisma.post.update.mockResolvedValue({ ...mockPost, isHidden: true });
      const result = await service.toggleVisibility('post-1');
      expect(result.isHidden).toBe(true);
    });
  });

  describe('update', () => {
    it('should throw ForbiddenException if not owner and not admin', async () => {
      mockPrisma.post.findUnique.mockResolvedValue(mockPost);
      await expect(
        service.update('post-1', 'other-user', 'BUYER', { title: 'Hacked' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow admin to edit', async () => {
      mockPrisma.post.findUnique.mockResolvedValue(mockPost);
      mockPrisma.post.update.mockResolvedValue({
        ...mockPost,
        title: 'Edited',
      });
      const result = await service.update('post-1', 'admin-1', 'ADMIN', {
        title: 'Edited',
      });
      expect(result.title).toBe('Edited');
    });
  });

  /**
   * B1: просроченная реклама — снятие `isPinned`.
   *
   * Мёртвый флаг: срок `adExpireDate` истёк, а `isPinned` остался. Проверяем
   * и сам метод (какие посты он трогает и чем), и идемпотентность, и что крон
   * не роняет процесс при ошибке БД.
   */
  describe('deactivateExpiredAds (B1)', () => {
    it('снимает isPinned только с ПРОСРОЧЕННОЙ рекламы (фильтр isAd+isPinned+adExpireDate<now)', async () => {
      mockPrisma.post.updateMany.mockResolvedValue({ count: 6 });

      const count = await service.deactivateExpiredAds();

      expect(count).toBe(6);
      // Фильтр: не «все посты», а именно просроченная активная реклама.
      expect(mockPrisma.post.updateMany).toHaveBeenCalledTimes(1);
      const call = mockPrisma.post.updateMany.mock.calls[0][0];
      expect(call.where.isAd).toBe(true);
      expect(call.where.isPinned).toBe(true);
      expect(call.where.adExpireDate.lt).toBeInstanceOf(Date);
      // lt(now), а не lte: ровно в момент истечения реклама ещё активна.
      expect(call.where.adExpireDate.lt.getTime()).toBeLessThanOrEqual(
        Date.now(),
      );
      // Только снимаем флаг — пост не удаляем и не скрываем.
      expect(call.data).toEqual({ isPinned: false });
      expect(mockPrisma.post.delete).not.toHaveBeenCalled();
    });

    it('идемпотентен: повторный прогон возвращает 0 (просроченных+запиненных нет)', async () => {
      mockPrisma.post.updateMany.mockResolvedValue({ count: 6 });
      await service.deactivateExpiredAds();
      mockPrisma.post.updateMany.mockResolvedValue({ count: 0 });

      const second = await service.deactivateExpiredAds();

      expect(second).toBe(0);
      expect(mockPrisma.post.updateMany).toHaveBeenCalledTimes(2);
    });

    it('крон возвращает счётчик и не бросает при ошибке БД', async () => {
      mockPrisma.post.updateMany.mockResolvedValue({ count: 3 });
      await expect(service.expireAdsCron()).resolves.toEqual({
        deactivated: 3,
      });

      mockPrisma.post.updateMany.mockRejectedValue(new Error('db down'));
      await expect(service.expireAdsCron()).resolves.toEqual({
        deactivated: 0,
      });
    });
  });
});
