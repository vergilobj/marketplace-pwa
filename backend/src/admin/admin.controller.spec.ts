import { Test, TestingModule } from '@nestjs/testing';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

describe('AdminController', () => {
  let controller: AdminController;
  let service: any;
  const mockService = {
    getDashboard: jest.fn(),
    getModerationLogs: jest.fn(),
    getSellerStats: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [{ provide: AdminService, useValue: mockService }],
    }).compile();
    controller = module.get<AdminController>(AdminController);
    service = mockService;
    jest.clearAllMocks();
  });

  it('should be defined', () => { expect(controller).toBeDefined(); });

  describe('getDashboard', () => {
    it('should return dashboard', async () => {
      service.getDashboard.mockResolvedValue({ usersCount: 100 });
      const result = await controller.getDashboard();
      expect(result.usersCount).toBe(100);
    });
  });

  describe('getModerationLogs', () => {
    it('should return moderation logs', async () => {
      service.getModerationLogs.mockResolvedValue({ items: [], total: 0 });
      await controller.getModerationLogs('1', '20');
      expect(service.getModerationLogs).toHaveBeenCalledWith(1, 20);
    });
  });

  describe('getSellerStats', () => {
    it('should return seller stats', async () => {
      service.getSellerStats.mockResolvedValue([]);
      expect(await controller.getSellerStats()).toEqual([]);
    });
  });
});
