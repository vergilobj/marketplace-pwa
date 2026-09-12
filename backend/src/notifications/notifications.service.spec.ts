import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let _prisma: any;

  const mockPrisma = {
    notification: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const mockConfig = {
    getOrThrow: jest.fn((key: string) => {
      if (key === 'ONESIGNAL_APP_ID') return 'test-app-id';
      if (key === 'ONESIGNAL_REST_API_KEY') return 'test-api-key';
      return '';
    }),
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    service = module.get<NotificationsService>(NotificationsService);
    _prisma = mockPrisma;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createNotification', () => {
    it('should create a notification', async () => {
      mockPrisma.notification.create.mockResolvedValue({
        id: 'n1',
        type: 'order',
        message: 'Test',
      });
      const result = await service.createNotification(
        'user-1',
        'order',
        'Test',
        'rel-1',
      );
      expect(result).toBeDefined();
      expect(mockPrisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          type: 'order',
          message: 'Test',
          relatedId: 'rel-1',
        },
      });
    });

    it('should return null on error', async () => {
      mockPrisma.notification.create.mockRejectedValue(new Error('DB Error'));
      const result = await service.createNotification(
        'user-1',
        'order',
        'Test',
      );
      expect(result).toBeNull();
    });
  });

  describe('getNotifications', () => {
    it('should use bulk default limit (100) on first page', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([]);
      await service.getNotifications('user-1');
      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 100 }),
      );
    });

    it('should offset by page and honour explicit limit', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([]);
      await service.getNotifications('user-1', { page: 3, limit: 25 });
      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 50, take: 25 }),
      );
    });

    it('should clamp limit above max (100) and page below 1', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([]);
      await service.getNotifications('user-1', { page: 0, limit: 100000 });
      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 100 }),
      );
    });

    it('should fall back to defaults on garbage params', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([]);
      await service.getNotifications('user-1', {
        page: 'abc' as unknown as number,
        limit: NaN,
      });
      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 100 }),
      );
    });

    it('should keep array response shape (no envelope)', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([{ id: 'n1' }]);
      const result = await service.getNotifications('user-1');
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('markAsRead', () => {
    it('should mark notification as read', async () => {
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 1 });
      await service.markAsRead('n1', 'user-1');
      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
        where: { id: 'n1', userId: 'user-1' },
        data: { isRead: true },
      });
    });
  });

  describe('markAllAsRead', () => {
    it('should mark all unread as read', async () => {
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 5 });
      await service.markAllAsRead('user-1');
      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', isRead: false },
        data: { isRead: true },
      });
    });
  });

  describe('getUnreadCount', () => {
    it('should return unread count', async () => {
      mockPrisma.notification.count.mockResolvedValue(3);
      expect(await service.getUnreadCount('user-1')).toBe(3);
    });
  });
});
