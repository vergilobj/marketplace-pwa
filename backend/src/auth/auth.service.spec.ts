import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { PrismaService } from '../common/prisma/prisma.service';

import { AuditService } from '../common/audit/audit.service';
import {
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

/**
 * FIX-AUTH (2026-09-13): спека переписана под новые контракты.
 *
 *  - register на занятый телефон больше НЕ бросает ConflictException (A-4):
 *    отвечает теми же токенами, но пользователя не создаёт, инвайт не жжёт
 *    и уведомляет владельца номера;
 *  - refreshToken принимает только токен (A-2): подпись + jti + запись в
 *    RefreshToken, ротация и reuse detection (ревокация всей цепочки);
 *  - появился changePassword: смена пароля гасит все refresh-токены.
 */
describe('AuthService', () => {
  let service: AuthService;

  const refreshTokenMock = {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  };

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
    refreshToken: refreshTokenMock,
    notification: { create: jest.fn() },
    $transaction: jest.fn(),
  };

  const mockJwtService = {
    sign: jest.fn().mockReturnValue('mock-token'),
    verify: jest.fn().mockReturnValue({ sub: '1', jti: 'jti-1' }),
  };

  const mockConfig = {
    get: jest.fn((key: string) => {
      if (key === 'JWT_REFRESH_SECRET') return 'test-refresh-secret';
      return 'test-secret';
    }),
  };

  const mockAudit = { log: jest.fn().mockResolvedValue({}) };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwtService as any },
        { provide: ConfigService, useValue: mockConfig },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();

    // Значения по умолчанию для моков.
    mockJwtService.sign.mockReturnValue('mock-token');
    mockJwtService.verify.mockReturnValue({ sub: '1', jti: 'jti-1' });
    refreshTokenMock.create.mockResolvedValue({ id: 'rt-1' });
    refreshTokenMock.updateMany.mockResolvedValue({ count: 1 });
    refreshTokenMock.update.mockResolvedValue({});
    mockPrisma.notification.create.mockResolvedValue({});
    mockPrisma.$transaction.mockImplementation((fn: any) =>
      fn({ refreshToken: refreshTokenMock }),
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    const dto = {
      phone: '+799****2233',
      name: 'Test User',
      password: 'password123',
      inviteCode: 'VALIDCODE',
    };

    it('A-4: занятый телефон → те же токены, но юзер не создаётся и инвайт не сжигается', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'existing' });

      const result = await service.register(dto);

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(mockPrisma.invite.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'existing' }),
        }),
      );
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'register_duplicate_phone_attempt',
        }),
      );
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
      mockPrisma.$transaction.mockImplementationOnce((fn: any) => {
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
          refreshToken: refreshTokenMock,
        };
        return fn(tx);
      });

      const result = await service.register(dto);
      expect(result).toHaveProperty('accessToken', 'mock-token');
      expect(result).toHaveProperty('refreshToken', 'mock-token');
      // A-2: refresh-токен записан в БД.
      expect(refreshTokenMock.create).toHaveBeenCalled();
    });
  });

  describe('login', () => {
    const dto = { phone: '+799****2233', password: 'correct' };

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
      const result = await service.login(dto);
      expect(result).toHaveProperty('accessToken', 'mock-token');
      expect(result).toHaveProperty('refreshToken', 'mock-token');
      expect(refreshTokenMock.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: '1' }),
        }),
      );
    });
  });

  describe('refreshToken (A-2: ротация + reuse detection)', () => {
    const activeRow = {
      id: 'rt-1',
      jti: 'jti-1',
      userId: '1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    };

    it('should throw UnauthorizedException if signature is invalid', async () => {
      mockJwtService.verify.mockImplementationOnce(() => {
        throw new Error('invalid');
      });
      await expect(service.refreshToken('bad-token')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(refreshTokenMock.findUnique).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException if jti is unknown', async () => {
      refreshTokenMock.findUnique.mockResolvedValueOnce(null);
      await expect(service.refreshToken('token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException if refresh token expired', async () => {
      refreshTokenMock.findUnique.mockResolvedValueOnce({
        ...activeRow,
        expiresAt: new Date('2020-01-01'),
      });
      await expect(service.refreshToken('token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('REUSE: повторное использование отозванного РОТИРОВАННОГО токена → 401 + вся цепочка отозвана', async () => {
      refreshTokenMock.findUnique.mockResolvedValueOnce({
        ...activeRow,
        revokedAt: new Date(),
        replacedById: 'rt-2',
      });
      refreshTokenMock.updateMany.mockResolvedValueOnce({ count: 3 });

      await expect(service.refreshToken('token')).rejects.toThrow(
        UnauthorizedException,
      );

      expect(refreshTokenMock.updateMany).toHaveBeenCalledWith({
        where: { userId: '1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'refresh_token_reuse_detected',
          metadata: expect.objectContaining({ revokedCount: 3 }),
        }),
      );
      // Новых токенов не выдали.
      expect(refreshTokenMock.create).not.toHaveBeenCalled();
    });

    it('отозванный БЕЗ замены (смена пароля) токен → 401, но цепочку НЕ гасим', async () => {
      refreshTokenMock.findUnique.mockResolvedValueOnce({
        ...activeRow,
        revokedAt: new Date(),
        replacedById: null,
      });

      await expect(service.refreshToken('token')).rejects.toThrow(
        UnauthorizedException,
      );

      // Иначе один старый refresh-токен выбивал бы юзера из всех устройств.
      expect(refreshTokenMock.updateMany).not.toHaveBeenCalled();
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'refresh_token_revoked_replay' }),
      );
    });

    it('valid refresh → новая пара, старая строка отозвана и связана с новой', async () => {
      refreshTokenMock.findUnique.mockResolvedValueOnce(activeRow);
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: '1',
        phone: '+7999',
        role: 'BUYER',
      });

      const result = await service.refreshToken('token');

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(refreshTokenMock.updateMany).toHaveBeenCalledWith({
        where: { jti: 'jti-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(refreshTokenMock.update).toHaveBeenCalledWith({
        where: { jti: 'jti-1' },
        data: { replacedById: 'rt-1' },
      });
      expect(refreshTokenMock.create).toHaveBeenCalled();
    });

    it('RACE: параллельный refresh уже отозвал jti → 401 + ревокация цепочки', async () => {
      refreshTokenMock.findUnique.mockResolvedValueOnce(activeRow);
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: '1',
        phone: '+7999',
        role: 'BUYER',
      });
      refreshTokenMock.updateMany.mockResolvedValueOnce({ count: 0 });
      refreshTokenMock.updateMany.mockResolvedValueOnce({ count: 2 });

      await expect(service.refreshToken('token')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'refresh_token_reuse_detected',
          metadata: expect.objectContaining({ race: true }),
        }),
      );
    });
  });

  describe('changePassword (A-2)', () => {
    it('should throw UnauthorizedException on wrong old password', async () => {
      const hash = await bcrypt.hash('correct', 10);
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: '1',
        phone: '+7999',
        role: 'BUYER',
        passwordHash: hash,
      });

      await expect(
        service.changePassword('1', {
          oldPassword: 'wrong',
          newPassword: 'newpass123',
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(refreshTokenMock.updateMany).not.toHaveBeenCalled();
    });

    it('success → пароль обновлён, все refresh-токены отозваны, выдана новая пара', async () => {
      const hash = await bcrypt.hash('correct', 10);
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: '1',
        phone: '+7999',
        role: 'BUYER',
        passwordHash: hash,
      });
      mockPrisma.user.update.mockResolvedValueOnce({});
      refreshTokenMock.updateMany.mockResolvedValueOnce({ count: 2 });

      const result = await service.changePassword('1', {
        oldPassword: 'correct',
        newPassword: 'newpass123',
      });

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: '1' } }),
      );
      expect(refreshTokenMock.updateMany).toHaveBeenCalledWith({
        where: { userId: '1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
    });
  });
});