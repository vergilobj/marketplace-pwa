import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let service: any;

  const mockAuthService = {
    register: jest.fn(),
    login: jest.fn(),
    refreshToken: jest.fn(),
    changePassword: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    }).compile();
    controller = module.get<AuthController>(AuthController);
    service = mockAuthService;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('register', () => {
    it('should call authService.register', async () => {
      const dto = {
        phone: '+7999',
        name: 'Test',
        password: 'pass',
        inviteCode: 'CODE',
      };
      service.register.mockResolvedValue({
        accessToken: 't',
        refreshToken: 'r',
      });
      const result = await controller.register(dto);
      expect(result).toHaveProperty('accessToken');
      expect(service.register).toHaveBeenCalledWith(dto);
    });
  });

  describe('login', () => {
    it('should call authService.login', async () => {
      const dto = { phone: '+7999', password: 'pass' };
      service.login.mockResolvedValue({ accessToken: 't', refreshToken: 'r' });
      const result = await controller.login(dto);
      expect(result).toHaveProperty('accessToken');
      expect(service.login).toHaveBeenCalledWith(dto);
    });
  });

  describe('refresh (A-2)', () => {
    it('должен передать токен в сервис как есть (без декода payload)', async () => {
      service.refreshToken.mockResolvedValue({
        accessToken: 't',
        refreshToken: 'r',
      });
      const result = await controller.refresh('token-123');
      expect(service.refreshToken).toHaveBeenCalledWith('token-123');
      expect(result).toHaveProperty('refreshToken');
    });

    it('пустой токен → 401, сервис не вызывается', async () => {
      await expect(controller.refresh('')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(service.refreshToken).not.toHaveBeenCalled();
    });
  });

  describe('changePassword (A-2)', () => {
    it('должен вызвать сервис с userId из токена', async () => {
      service.changePassword.mockResolvedValue({
        accessToken: 't',
        refreshToken: 'r',
      });
      const dto = { oldPassword: 'old12345', newPassword: 'new12345' };
      const req = { user: { userId: 'u-1', role: 'BUYER' } } as any;

      const result = await controller.changePassword(req, dto);

      expect(service.changePassword).toHaveBeenCalledWith('u-1', dto);
      expect(result).toHaveProperty('accessToken');
    });
  });
});