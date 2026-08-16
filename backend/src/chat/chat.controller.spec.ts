import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { PrismaService } from '../common/prisma/prisma.service';

describe('ChatController', () => {
  let controller: ChatController;
  let svc: any;
  let cfg: any;

  beforeEach(async () => {
    svc = { moderateMessage: jest.fn() };
    cfg = { getOrThrow: jest.fn().mockReturnValue('webhook-secret') };
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        { provide: PrismaService, useValue: {} },
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
      'webhook-secret',
    );
    expect(r).toEqual({ action: 'allowed' });
  });

  it('rejects invalid sig', async () => {
    const r = await controller.handleWebhook(
      { id: '1', text: 'hi' } as any,
      'wrong-secret',
    );
    expect(r).toEqual({ status: 'rejected', reason: 'invalid_signature' });
  });

  it('rejects missing sig', async () => {
    const r = await controller.handleWebhook(
      { id: '1', text: 'hi' } as any,
      undefined as any,
    );
    expect(r).toEqual({ status: 'rejected', reason: 'invalid_signature' });
  });
});
