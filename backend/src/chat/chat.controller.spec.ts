import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { PrismaService } from '../common/prisma/prisma.service';

describe('ChatController', () => {
  let controller: ChatController;
  let svc: any;
  let cfg: any;

  beforeEach(async () => {
    svc = { setPublicKey: jest.fn() };
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

  it('should set public key', async () => {
    svc.setPublicKey.mockResolvedValue({ ok: true });
    const result = await controller.setPublicKey(
      { user: { userId: 'u1', role: UserRole.BUYER } },
      'KEY',
    );
    expect(result).toEqual({ ok: true });
    expect(svc.setPublicKey).toHaveBeenCalledWith('u1', 'KEY');
  });
});