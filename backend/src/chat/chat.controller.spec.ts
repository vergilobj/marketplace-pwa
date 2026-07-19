import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

jest.mock('crypto', () => ({
  createHmac: jest.fn().mockReturnValue({
    update: jest.fn().mockReturnValue({
      digest: jest.fn().mockReturnValue('mock-sig'),
    }),
  }),
}));

describe('ChatController', () => {
  let controller: ChatController;
  let svc: any;
  let cfg: any;

  beforeEach(async () => {
    svc = { moderateMessage: jest.fn() };
    cfg = { get: jest.fn().mockReturnValue('secret') };
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        { provide: ChatService, useValue: svc },
        { provide: ConfigService, useValue: cfg },
      ],
    }).compile();
    controller = mod.get<ChatController>(ChatController);
    jest.clearAllMocks();
  });

  it('defined', () => expect(controller).toBeDefined());

  it('accepts valid sig', async () => {
    svc.moderateMessage.mockResolvedValue({ action: 'allowed' });
    const r = await controller.handleWebhook(
      { id: '1', text: 'hi' } as any,
      'mock-sig',
    );
    expect(r.action).toBe('allowed');
  });

  it('rejects missing sig', async () => {
    await expect(
      controller.handleWebhook(
        { id: '1', text: 'hi' } as any,
        undefined as any,
      ),
    ).rejects.toThrow('Missing webhook signature');
  });

  it('rejects missing secret', async () => {
    cfg.get.mockReturnValue(undefined);
    await expect(
      controller.handleWebhook({ id: '1', text: 'hi' } as any, 'x'),
    ).rejects.toThrow('Webhook secret not configured');
  });
});
