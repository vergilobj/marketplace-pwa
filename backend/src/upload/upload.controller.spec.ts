import { Test, TestingModule } from '@nestjs/testing';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import { UploadsReplicationService } from './uploads-replication.service';

describe('UploadController', () => {
  let controller: UploadController;
  let service: any;
  let replication: any;
  const mockService = { getFileUrl: jest.fn(), getVideoUrl: jest.fn() };
  const mockReplication = { replicate: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UploadController],
      providers: [
        { provide: UploadService, useValue: mockService },
        // PD-FIX-1: репликация на вторую ноду. В юнит-тесте — мок: scp не бегаем.
        { provide: UploadsReplicationService, useValue: mockReplication },
      ],
    }).compile();
    controller = module.get<UploadController>(UploadController);
    service = mockService;
    replication = mockReplication;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('uploadFile', () => {
    it('should return file URL', () => {
      service.getFileUrl.mockReturnValue('https://cdn/uploads/file.png');
      const result = controller.uploadFile({ filename: 'file.png' } as any);
      expect(result.url).toBe('https://cdn/uploads/file.png');
    });

    it('PD-FIX-1: ставит файл в очередь репликации на вторую ноду', () => {
      service.getFileUrl.mockReturnValue('https://cdn/uploads/file.png');
      controller.uploadFile({ filename: 'file.png' } as any);
      expect(replication.replicate).toHaveBeenCalledWith('file.png');
    });
  });

  describe('uploadVideo', () => {
    it('PD-FIX-1: видео реплицируется в подпапку videos/', () => {
      service.getVideoUrl.mockReturnValue('https://cdn/uploads/videos/v.mp4');
      const result = controller.uploadVideo({ filename: 'v.mp4' } as any);
      expect(result.url).toBe('https://cdn/uploads/videos/v.mp4');
      expect(replication.replicate).toHaveBeenCalledWith('videos/v.mp4');
    });
  });
});