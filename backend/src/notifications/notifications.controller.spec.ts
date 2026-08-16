import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../common/prisma/prisma.service';

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let service: any;
  const mockService = {
    getNotifications: jest.fn(),
    markAsRead: jest.fn(),
    markAllAsRead: jest.fn(),
    getUnreadCount: jest.fn(),
  };
  const mockPrisma = { user: { findMany: jest.fn() } };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        { provide: NotificationsService, useValue: mockService },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    controller = module.get<NotificationsController>(NotificationsController);
    service = mockService;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getNotifications', () => {
    it('should return notifications', async () => {
      service.getNotifications.mockResolvedValue([]);
      expect(
        await controller.getNotifications({ user: { userId: 'u1', role: 'ADMIN' } }),
      ).toEqual([]);
    });
  });

  describe('markAsRead', () => {
    it('should mark as read', async () => {
      service.markAsRead.mockResolvedValue({ count: 1 });
      await controller.markAsRead('n1', { user: { userId: 'u1', role: 'ADMIN' } });
      expect(service.markAsRead).toHaveBeenCalledWith('n1', 'u1');
    });
  });

  describe('markAllAsRead', () => {
    it('should mark all as read', async () => {
      await controller.markAllAsRead({ user: { userId: 'u1', role: 'ADMIN' } });
      expect(service.markAllAsRead).toHaveBeenCalledWith('u1');
    });
  });

  describe('getUnreadCount', () => {
    it('should return unread count', async () => {
      service.getUnreadCount.mockResolvedValue(5);
      expect(
        await controller.getUnreadCount({ user: { userId: 'u1', role: 'ADMIN' } }),
      ).toEqual({ count: 5 });
    });
  });
});
