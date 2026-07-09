import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let service: any;

  const mockAuthService = {
    register: jest.fn(),
    login: jest.fn(),
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

  it('should be defined', () => { expect(controller).toBeDefined(); });

  describe('register', () => {
    it('should call authService.register', async () => {
      const dto = { phone: '+7999', name: 'Test', password: 'pass', inviteCode: 'CODE' };
      service.register.mockResolvedValue({ accessToken: 't', refreshToken: 'r' });
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
});
