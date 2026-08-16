import { Test, TestingModule } from '@nestjs/testing';
import { SettingsService } from './settings.service';
import { PrismaService } from '../common/prisma/prisma.service';

describe('SettingsService', () => {
  let service: SettingsService;
  let _prisma: any;

  const mockPrisma = {
    setting: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettingsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<SettingsService>(SettingsService);
    _prisma = mockPrisma;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('get', () => {
    it('should return setting value', async () => {
      mockPrisma.setting.findUnique.mockResolvedValue({
        key: 'test',
        value: '42',
      });
      expect(await service.get('test')).toBe('42');
    });

    it('should return null if not found', async () => {
      mockPrisma.setting.findUnique.mockResolvedValue(null);
      expect(await service.get('missing')).toBeNull();
    });
  });

  describe('getFloat', () => {
    it('should return parsed float', async () => {
      mockPrisma.setting.findUnique.mockResolvedValue({
        key: 'fee',
        value: '12.5',
      });
      expect(await service.getFloat('fee')).toBe(12.5);
    });

    it('should return 0 if not found', async () => {
      mockPrisma.setting.findUnique.mockResolvedValue(null);
      expect(await service.getFloat('missing')).toBe(0);
    });
  });

  describe('set', () => {
    it('should upsert setting', async () => {
      mockPrisma.setting.upsert.mockResolvedValue({
        key: 'key1',
        value: 'val1',
      });
      const result = await service.set('key1', 'val1');
      expect(result).toEqual({ key: 'key1', value: 'val1' });
    });
  });

  describe('getAll', () => {
    it('should return all settings', async () => {
      mockPrisma.setting.findMany.mockResolvedValue([
        { key: 'k1', value: 'v1' },
      ]);
      expect(await service.getAll()).toHaveLength(1);
    });
  });
});
