import { Test, TestingModule } from '@nestjs/testing';
import { InvitesService } from './invites.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { BadRequestException } from '@nestjs/common';

describe('InvitesService', () => {
  let service: InvitesService;
  let _prisma: any;

  const mockInvite = {
    code: 'ABC123',
    ownerId: 'owner-1',
    isUsed: false,
    createdAt: new Date(),
  };

  const mockPrisma = {
    invite: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvitesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<InvitesService>(InvitesService);
    prisma = mockPrisma;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createInvite', () => {
    it('should create invite with custom code', async () => {
      mockPrisma.invite.findUnique.mockResolvedValue(null);
      mockPrisma.invite.create.mockResolvedValue({
        ...mockInvite,
        code: 'MYCODE',
      });
      const result = await service.createInvite('owner-1', 'MYCODE');
      expect(result.code).toBe('MYCODE');
      expect(mockPrisma.invite.create).toHaveBeenCalledWith({
        data: { code: 'MYCODE', ownerId: 'owner-1' },
      });
    });

    it('should throw if custom code already exists', async () => {
      mockPrisma.invite.findUnique.mockResolvedValue(mockInvite);
      await expect(service.createInvite('owner-1', 'ABC123')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should auto-generate unique code', async () => {
      mockPrisma.invite.findUnique.mockResolvedValueOnce(null);
      mockPrisma.invite.create.mockResolvedValue({
        ...mockInvite,
        code: 'XYZ789',
      });
      const result = await service.createInvite('owner-1');
      expect(result.code).toBeDefined();
      expect(result.ownerId).toBe('owner-1');
    });

    it('should retry on collision up to 10 attempts', async () => {
      mockPrisma.invite.findUnique
        .mockResolvedValueOnce({ code: 'TAKEN' })
        .mockResolvedValueOnce({ code: 'TAKEN' })
        .mockResolvedValueOnce(null);
      mockPrisma.invite.create.mockResolvedValue({
        ...mockInvite,
        code: 'FRESH',
      });
      const result = await service.createInvite('owner-1');
      expect(result.code).toBe('FRESH');
      expect(mockPrisma.invite.findUnique).toHaveBeenCalledTimes(3);
    });
  });

  describe('findAll', () => {
    it('should return all invites with relations', async () => {
      mockPrisma.invite.findMany.mockResolvedValue([mockInvite]);
      expect(await service.findAll()).toHaveLength(1);
    });
  });

  describe('delete', () => {
    it('should delete invite by code', async () => {
      mockPrisma.invite.delete.mockResolvedValue(mockInvite);
      expect(await service.delete('ABC123')).toEqual(mockInvite);
    });
  });
});
