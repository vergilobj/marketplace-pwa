import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { CometChatService } from '../cometchat/cometchat.service';
import {
  ConflictException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

describe('AuthService', () => {
  let service: AuthService;
  let _prisma: any;
  let _jwtService: JwtService;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    invite: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockJwtService = {
    sign: jest.fn().mockReturnValue('mock-token'),
    verify: jest.fn().mockReturnValue({ sub: 'user-1' }),
  };

  const mockConfig = {
    get: jest.fn((key: string) => {
      if (key === 'JWT_REFRESH_SECRET') return 'test-refresh-secret';
      return 'test-secret';
    }),
  };

  const mockCometChat = {
    createUser: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfig },
        { provide: CometChatService, useValue: mockCometChat },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prisma = mockPrisma;
    jwtService = mockJwtService;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    const dto = {
      phone: '+79991112233',
      name: 'Test User',
      password: 'password123',
      inviteCode: 'VALIDCODE',
    };

    it('should throw ConflictException if phone already registered', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'existing' });
      await expect(service.register(dto)).rejects.toThrow(ConflictException);
    });

    it('should throw BadRequestException if invite does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      mockPrisma.invite.findUnique.mockResolvedValueOnce(null);
      await expect(service.register(dto)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if invite is already used', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      mockPrisma.invite.findUnique.mockResolvedValueOnce({
        code: 'USEDCODE',
        isUsed: true,
        expiresAt: null,
      });
      await expect(
        service.register({ ...dto, inviteCode: 'USEDCODE' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if invite is expired', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      mockPrisma.invite.findUnique.mockResolvedValueOnce({
        code: 'EXPIRED',
        isUsed: false,
        expiresAt: new Date('2020-01-01'),
      });
      await expect(
        service.register({ ...dto, inviteCode: 'EXPIRED' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should register user successfully with valid invite', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      mockPrisma.invite.findUnique.mockResolvedValueOnce({
        code: 'VALIDCODE',
        isUsed: false,
        expiresAt: null,
        ownerId: 'owner-1',
      });
      mockPrisma.$transaction.mockImplementation((fn: any) => {
        const tx = {
          user: {
            create: jest.fn().mockResolvedValue({
              id: 'new-user',
              phone: dto.phone,
              name: dto.name,
              role: 'BUYER',
              referralCode: 'ABC12345',
            }),
          },
          invite: { update: jest.fn().mockResolvedValue({}) },
        };
        return fn(tx);
      });

      const result = await service.register(dto);
      expect(result).toHaveProperty('accessToken', 'mock-token');
      expect(result).toHaveProperty('refreshToken', 'mock-token');
      expect(mockCometChat.createUser).toHaveBeenCalled();
    });

    it('should still return tokens even if CometChat creation fails', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      mockPrisma.invite.findUnique.mockResolvedValueOnce({
        code: 'VALIDCODE',
        isUsed: false,
        expiresAt: null,
        ownerId: 'owner-1',
      });
      mockPrisma.$transaction.mockImplementation((fn: any) => {
        const tx = {
          user: {
            create: jest.fn().mockResolvedValue({
              id: 'new-user',
              phone: dto.phone,
              name: dto.name,
              role: 'BUYER',
              referralCode: 'ABC12345',
            }),
          },
          invite: { update: jest.fn().mockResolvedValue({}) },
        };
        return fn(tx);
      });
      mockCometChat.createUser.mockRejectedValueOnce(new Error('API Error'));

      const result = await service.register(dto);
      expect(result).toHaveProperty('accessToken', 'mock-token');
    });
  });

  describe('login', () => {
    const dto = { phone: '+79991112233', password: 'correct' };

    it('should throw UnauthorizedException if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if user has no password', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: '1',
        phone: dto.phone,
        passwordHash: null,
      });
      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if password is wrong', async () => {
      const hash = await bcrypt.hash('correct', 10);
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: '1',
        phone: dto.phone,
        passwordHash: hash,
        role: 'BUYER',
      });
      mockPrisma.user.findMany.mockResolvedValueOnce([]);
      await expect(
        service.login({ ...dto, password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should return tokens on successful login', async () => {
      const hash = await bcrypt.hash('correct', 10);
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: '1',
        phone: dto.phone,
        passwordHash: hash,
        role: 'BUYER',
      });
      mockPrisma.user.findMany.mockResolvedValueOnce([]);
      const result = await service.login(dto);
      expect(result).toHaveProperty('accessToken', 'mock-token');
      expect(result).toHaveProperty('refreshToken', 'mock-token');
    });
  });

  describe('refreshToken', () => {
    it('should throw UnauthorizedException if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      await expect(service.refreshToken('bad-id', 'token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException if refresh token is invalid', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: '1',
        role: 'BUYER',
      });
      mockJwtService.verify.mockImplementationOnce(() => {
        throw new Error('invalid');
      });
      await expect(service.refreshToken('1', 'bad-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should return new tokens on valid refresh', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: '1',
        role: 'BUYER',
      });
      const result = await service.refreshToken('1', 'valid-token');
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
    });
  });
});
