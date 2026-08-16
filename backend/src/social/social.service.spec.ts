import { Test, TestingModule } from '@nestjs/testing';
import { SocialService } from './social.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';

describe('SocialService', () => {
  let service: SocialService;
  let _prisma: any;

  const mockPrisma = {
    post: { findUnique: jest.fn() },
    like: {
      create: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
    },
    comment: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
  const mockNotifications = {
    createNotification: jest.fn().mockResolvedValue({}),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SocialService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();
    service = module.get<SocialService>(SocialService);
    _prisma = mockPrisma;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('likePost', () => {
    it('should throw NotFoundException if post does not exist', async () => {
      mockPrisma.post.findUnique.mockResolvedValue(null);
      await expect(service.likePost('user-1', 'bad-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should like a post and notify author', async () => {
      mockPrisma.post.findUnique.mockResolvedValue({
        id: 'post-1',
        authorId: 'author-1',
      });
      mockPrisma.like.create.mockResolvedValue({ id: 'like-1' });
      const result = await service.likePost('user-1', 'post-1');
      expect(result.liked).toBe(true);
      expect(mockNotifications.createNotification).toHaveBeenCalled();
    });

    it('should not notify when liking own post', async () => {
      mockPrisma.post.findUnique.mockResolvedValue({
        id: 'post-1',
        authorId: 'user-1',
      });
      mockPrisma.like.create.mockResolvedValue({ id: 'like-1' });
      await service.likePost('user-1', 'post-1');
      expect(mockNotifications.createNotification).not.toHaveBeenCalled();
    });

    it('should throw ConflictException on duplicate like', async () => {
      mockPrisma.post.findUnique.mockResolvedValue({
        id: 'post-1',
        authorId: 'author-1',
      });
      mockPrisma.like.create.mockRejectedValue({ code: 'P2002' });
      await expect(service.likePost('user-1', 'post-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('unlikePost', () => {
    it('should throw NotFoundException if like not found', async () => {
      mockPrisma.like.findUnique.mockResolvedValue(null);
      await expect(service.unlikePost('user-1', 'post-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should unlike a post', async () => {
      mockPrisma.like.findUnique.mockResolvedValue({ id: 'like-1' });
      mockPrisma.like.delete.mockResolvedValue({});
      const result = await service.unlikePost('user-1', 'post-1');
      expect(result.liked).toBe(false);
    });
  });

  describe('addComment', () => {
    it('should throw NotFoundException if post does not exist', async () => {
      mockPrisma.post.findUnique.mockResolvedValue(null);
      await expect(
        service.addComment('user-1', 'bad-id', 'Nice!'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should add comment and notify', async () => {
      mockPrisma.post.findUnique.mockResolvedValue({
        id: 'post-1',
        authorId: 'author-1',
      });
      mockPrisma.comment.create.mockResolvedValue({
        id: 'c1',
        text: 'Nice!',
        user: { id: 'user-1', name: 'User' },
      });
      const result = await service.addComment('user-1', 'post-1', 'Nice!');
      expect(result.text).toBe('Nice!');
      expect(mockNotifications.createNotification).toHaveBeenCalled();
    });
  });

  describe('updateComment', () => {
    it('should throw ForbiddenException if not owner and not admin', async () => {
      mockPrisma.comment.findUnique.mockResolvedValue({
        id: 'c1',
        userId: 'owner',
      });
      await expect(
        service.updateComment('c1', 'other', 'BUYER', 'Edited'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should update comment if owner', async () => {
      mockPrisma.comment.findUnique.mockResolvedValue({
        id: 'c1',
        userId: 'user-1',
      });
      mockPrisma.comment.update.mockResolvedValue({
        id: 'c1',
        text: 'Edited',
        user: { id: 'user-1', name: 'User' },
      });
      const result = await service.updateComment(
        'c1',
        'user-1',
        'BUYER',
        'Edited',
      );
      expect(result.text).toBe('Edited');
    });
  });

  describe('deleteComment', () => {
    it('should throw ForbiddenException if not owner and not admin', async () => {
      mockPrisma.comment.findUnique.mockResolvedValue({
        id: 'c1',
        userId: 'owner',
      });
      await expect(
        service.deleteComment('c1', 'other', 'BUYER'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should delete comment', async () => {
      mockPrisma.comment.findUnique.mockResolvedValue({
        id: 'c1',
        userId: 'user-1',
      });
      mockPrisma.comment.delete.mockResolvedValue({});
      const result = await service.deleteComment('c1', 'user-1', 'BUYER');
      expect(result.deleted).toBe(true);
    });
  });
});
