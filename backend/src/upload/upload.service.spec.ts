import { Test, TestingModule } from '@nestjs/testing';
import { UploadService } from './upload.service';
import { ConfigService } from '@nestjs/config';

describe('UploadService', () => {
  let service: UploadService;
  let config: any;

  const mockConfig = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UploadService,
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    service = module.get<UploadService>(UploadService);
    config = mockConfig;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getFileUrl', () => {
    it('should use configured base URL', () => {
      config.get.mockReturnValue('https://cdn.example.com');
      expect(service.getFileUrl('photo.png')).toBe(
        'https://cdn.example.com/uploads/photo.png',
      );
    });

    it('should fall back to relative path', () => {
      config.get.mockReturnValue(undefined);
      expect(service.getFileUrl('photo.png')).toBe('/uploads/photo.png');
    });

    it('should handle filenames with special characters', () => {
      config.get.mockReturnValue('https://cdn.example.com');
      expect(service.getFileUrl('photo (1).png')).toBe(
        'https://cdn.example.com/uploads/photo (1).png',
      );
    });
  });
});
