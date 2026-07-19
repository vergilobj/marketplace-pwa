import { Test, TestingModule } from '@nestjs/testing';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';

describe('UploadController', () => {
  let controller: UploadController;
  let service: any;
  const mockService = { getFileUrl: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UploadController],
      providers: [{ provide: UploadService, useValue: mockService }],
    }).compile();
    controller = module.get<UploadController>(UploadController);
    service = mockService;
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
  });
});
