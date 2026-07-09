import { Test, TestingModule } from '@nestjs/testing';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

describe('SettingsController', () => {
  let controller: SettingsController;
  let service: any;
  const mockService = {
    getAll: jest.fn(),
    set: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SettingsController],
      providers: [{ provide: SettingsService, useValue: mockService }],
    }).compile();
    controller = module.get<SettingsController>(SettingsController);
    service = mockService;
    jest.clearAllMocks();
  });

  it('should be defined', () => { expect(controller).toBeDefined(); });

  describe('getAll', () => {
    it('should return all settings', async () => {
      service.getAll.mockResolvedValue([]);
      expect(await controller.getAll()).toEqual([]);
    });
  });

  describe('update', () => {
    it('should set a setting', async () => {
      service.set.mockResolvedValue({ key: 'k', value: 'v' });
      await controller.update({ key: 'k', value: 'v' });
      expect(service.set).toHaveBeenCalledWith('k', 'v');
    });
  });
});
