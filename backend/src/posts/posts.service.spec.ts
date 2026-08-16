import { Test, TestingModule } from '@nestjs/testing';
import { PostsService } from './posts.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { PaymentsService } from '../payments/payments.service';
import { NotificationsService } from '../notifications/notifications.service';
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
      delete: jest.fn(),
      count: jest.fn(),
    },
    user: { findFirst: jest.fn() },
    order: { create: jest.fn(), findUnique: jest.fn() },
    like: { deleteMany: jest.fn() },
    comment: { deleteMany: jest.fn() },
  };
  const mockSettings = {
    getFloat: jest.fn().mockResolvedValue(5000),
  };
  const mockPayments = {
    createPaymentForOrder: jest.fn().mockResolvedValue({}),
    processSuccessfulPayment: jest.fn().mockResolvedValue({}),
  };
  const mockNotifications = {
    createNotification: jest.fn().mockResolvedValue({}),
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
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();
    service = module.get<PostsService>(PostsService);
    _prisma = mockPrisma;
    jest.clearAllMocks();
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

    it('should create ad order and activate', async () => {
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
      const result = await service.createAd('seller-1', {
        title: 'Ad',
        content: '',
        link: '',
        days: 7,
      });
      expect(result).toBeDefined();
      expect(mockPayments.createPaymentForOrder).toHaveBeenCalled();
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
});
