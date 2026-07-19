import { Test, TestingModule } from '@nestjs/testing';
import { ChatService } from './chat.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

describe('ChatService', () => {
  let service: ChatService;
  let _prisma: any;
  let settings: any;

  const mockPrisma = {
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
    prisma = mockPrisma;
    settings = mockSettings;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('moderateMessage', () => {
    it('should allow clean message', async () => {
      settings.get.mockResolvedValue(null);
      const result = await service.moderateMessage({
        id: 'msg-1',
        text: 'Hello world',
      } as any);
      expect(result.action).toBe('allowed');
    });

    it('should hide message with phone number', async () => {
      settings.get.mockResolvedValue(null);
      const result = await service.moderateMessage({
        id: 'msg-2',
        text: 'Call me +79161234567',
      } as any);
      expect(result.action).toBe('hidden');
      expect(result.reason).toBe('Contact info detected');
      expect(mockPrisma.moderationLog.create).toHaveBeenCalled();
    });

    it('should hide message with email', async () => {
      settings.get.mockResolvedValue(null);
      const result = await service.moderateMessage({
        id: 'msg-3',
        text: 'Email me at test@example.com',
      } as any);
      expect(result.action).toBe('hidden');
      expect(result.reason).toBe('Contact info detected');
    });

    it('should hide message with URL', async () => {
      settings.get.mockResolvedValue(null);
      const result = await service.moderateMessage({
        id: 'msg-4',
        text: 'Check https://scam.com',
      } as any);
      expect(result.action).toBe('hidden');
      expect(result.reason).toBe('Contact info detected');
    });

    it('should hide message with stop words', async () => {
      settings.get.mockResolvedValue(
        JSON.stringify(['spam', 'scam', 'badword']),
      );
      const result = await service.moderateMessage({
        id: 'msg-5',
        text: 'This is spam content',
      } as any);
      expect(result.action).toBe('hidden');
      expect(result.reason).toBe('Stop word detected');
    });

    it('should be case-insensitive for stop words', async () => {
      settings.get.mockResolvedValue(JSON.stringify(['SPAM']));
      const result = await service.moderateMessage({
        id: 'msg-6',
        text: 'this is SpAm!!!',
      } as any);
      expect(result.action).toBe('hidden');
    });

    it('should allow message without stop words', async () => {
      settings.get.mockResolvedValue(JSON.stringify(['spam']));
      const result = await service.moderateMessage({
        id: 'msg-7',
        text: 'Normal message',
      } as any);
      expect(result.action).toBe('allowed');
    });
  });
});
