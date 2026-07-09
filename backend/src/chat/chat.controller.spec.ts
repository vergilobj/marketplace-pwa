import { Test, TestingModule } from '@nestjs/testing';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

describe('ChatController', () => {
  let controller: ChatController;
  let service: any;
  const mockService = {
    moderateMessage: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [{ provide: ChatService, useValue: mockService }],
    }).compile();
    controller = module.get<ChatController>(ChatController);
    service = mockService;
    jest.clearAllMocks();
  });

  it('should be defined', () => { expect(controller).toBeDefined(); });

  describe('handleWebhook', () => {
    it('should moderate message', async () => {
      service.moderateMessage.mockResolvedValue({ action: 'allowed' });
      const msg = { id: 'msg-1', text: 'Hello' } as any;
      const result = await controller.handleWebhook(msg);
      expect(result.action).toBe('allowed');
      expect(service.moderateMessage).toHaveBeenCalledWith(msg);
    });
  });
});
