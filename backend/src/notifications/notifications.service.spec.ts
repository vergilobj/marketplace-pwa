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
    it('should return last 50 notifications', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([]);
      await service.getNotifications('user-1');
      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
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
