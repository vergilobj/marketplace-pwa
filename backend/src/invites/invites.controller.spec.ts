import { Test, TestingModule } from '@nestjs/testing';
import { InvitesController } from './invites.controller';
import { InvitesService } from './invites.service';

describe('InvitesController', () => {
  let controller: InvitesController;
  let service: any;
  const mockService = {
    createInvite: jest.fn(),
    findAll: jest.fn(),
    delete: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [InvitesController],
      providers: [{ provide: InvitesService, useValue: mockService }],
    }).compile();
    controller = module.get<InvitesController>(InvitesController);
    service = mockService;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should create invite', async () => {
      service.createInvite.mockResolvedValue({ code: 'CODE', ownerId: 'u1' });
      const result = await controller.create(
        { user: { userId: 'u1' } },
        'MYCODE',
      );
      expect(result.code).toBe('CODE');
      expect(service.createInvite).toHaveBeenCalledWith('u1', 'MYCODE');
    });
  });

  describe('findAll', () => {
    it('should return invites', async () => {
      service.findAll.mockResolvedValue([]);
      expect(await controller.findAll()).toEqual([]);
    });
  });

  describe('delete', () => {
    it('should delete invite', async () => {
      service.delete.mockResolvedValue({ code: 'CODE' });
      await controller.delete('CODE');
      expect(service.delete).toHaveBeenCalledWith('CODE');
    });
  });
});
