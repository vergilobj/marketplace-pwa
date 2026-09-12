import { Test, TestingModule } from '@nestjs/testing';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import { UploadsReplicationService } from './uploads-replication.service';
import { ImageOptimizerService } from './image-optimizer.service';

describe('UploadController', () => {
  let controller: UploadController;
  let service: any;
  let replication: any;
  let optimizer: any;
  const mockService = { getFileUrl: jest.fn(), getVideoUrl: jest.fn() };
  const mockReplication = { replicate: jest.fn() };
  // FIX-REST фикс 3: сжатие картинок. В юнит-тесте — мок: sharp не дёргаем.
  const mockOptimizer = { optimize: jest.fn().mockResolvedValue({ skipped: false, before: 1, after: 1 }) };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UploadController],
      providers: [
        { provide: UploadService, useValue: mockService },
        // PD-FIX-1: репликация на вторую ноду. В юнит-тесте — мок: scp не бегаем.
        { provide: UploadsReplicationService, useValue: mockReplication },
        { provide: ImageOptimizerService, useValue: mockOptimizer },
      ],
    }).compile();
    controller = module.get<UploadController>(UploadController);
    service = mockService;
    replication = mockReplication;
    optimizer = mockOptimizer;
    jest.clearAllMocks();
    mockOptimizer.optimize.mockResolvedValue({ skipped: false, before: 1, after: 1 });
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('uploadFile', () => {
    it('should return file URL', async () => {
      service.getFileUrl.mockReturnValue('https://cdn/uploads/file.png');
      const result = await controller.uploadFile({ filename: 'file.png' } as any);
      expect(result.url).toBe('https://cdn/uploads/file.png');
    });

    it('PD-FIX-1: ставит файл в очередь репликации на вторую ноду', async () => {
      service.getFileUrl.mockReturnValue('https://cdn/uploads/file.png');
      await controller.uploadFile({ filename: 'file.png' } as any);
      expect(replication.replicate).toHaveBeenCalledWith('file.png');
    });

    it('FIX-REST-3: сжимает картинку ДО репликации (иначе на вторую ноду уедет оригинал)', async () => {
      const order: string[] = [];
      mockOptimizer.optimize.mockImplementation(async () => {
        order.push('optimize');
        return { skipped: false, before: 1, after: 1 };
      });
      mockReplication.replicate.mockImplementation(() => order.push('replicate'));

      service.getFileUrl.mockReturnValue('https://cdn/uploads/file.png');
      await controller.uploadFile({ filename: 'file.png' } as any);

      expect(order).toEqual(['optimize', 'replicate']);
      expect(mockOptimizer.optimize).toHaveBeenCalledWith(expect.stringContaining('file.png'));
    });

    it('FIX-REST-3: сбой сжатия не ломает загрузку (best-effort)', async () => {
      mockOptimizer.optimize.mockResolvedValue({ skipped: true, before: 0, after: 0, reason: 'error' });
      service.getFileUrl.mockReturnValue('https://cdn/uploads/file.png');
      const result = await controller.uploadFile({ filename: 'file.png' } as any);
      expect(result.url).toBe('https://cdn/uploads/file.png');
      expect(replication.replicate).toHaveBeenCalled();
    });
  });

  describe('uploadVideo', () => {
    it('PD-FIX-1: видео реплицируется в подпапку videos/', async () => {
      service.getVideoUrl.mockReturnValue('https://cdn/uploads/videos/v.mp4');
      const result = await controller.uploadVideo({ filename: 'v.mp4' } as any);
      expect(result.url).toBe('https://cdn/uploads/videos/v.mp4');
      expect(replication.replicate).toHaveBeenCalledWith('videos/v.mp4');
    });

    it('FIX-REST-3: видео НЕ прогоняется через оптимизатор картинок', async () => {
      service.getVideoUrl.mockReturnValue('https://cdn/uploads/videos/v.mp4');
      await controller.uploadVideo({ filename: 'v.mp4' } as any);
      expect(mockOptimizer.optimize).not.toHaveBeenCalled();
    });
  });
});