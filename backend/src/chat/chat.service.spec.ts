import { Test, TestingModule } from '@nestjs/testing';
import { ChatService } from './chat.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

describe('ChatService', () => {
  let service: ChatService;
  let _prisma: any;
  let settings: any;

  const mockPrisma = {
    user: { update: jest.fn() },
    moderationLog: { create: jest.fn() },
  };
  const mockSettings = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SettingsService, useValue: mockSettings },
      ],
    }).compile();
    service = module.get<ChatService>(ChatService);
    _prisma = mockPrisma;
    settings = mockSettings;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('setPublicKey', () => {
    it('should update user public key', async () => {
      mockPrisma.user.update.mockResolvedValue({ id: 'u1', chatPublicKey: 'KEY' });
      const result = await service.setPublicKey('u1', 'KEY');
      expect(result.chatPublicKey).toBe('KEY');
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { chatPublicKey: 'KEY' },
      });
    });
  });
});