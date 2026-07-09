import { Test, TestingModule } from '@nestjs/testing';
import { ProductsService } from './products.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotFoundException, ForbiddenException } from '@nestjs/common';

describe('ProductsService', () => {
  let service: ProductsService;
  let prisma: any;

  const mockProduct = {
    id: 'prod-1',
    title: 'Test Product',
    description: 'Test Description',
    price: 1000,
    media: [],
    sellerId: 'seller-1',
    seller: { id: 'seller-1', name: 'Seller' },
    isActive: true,
    createdAt: new Date(),
  };

  const mockPrisma = {
    product: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    order: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    transaction: {
      deleteMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
    prisma = mockPrisma;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a product', async () => {
      const dto = { title: 'Test', description: 'Desc', price: 100 };
      mockPrisma.product.create.mockResolvedValue(mockProduct);
      const result = await service.create('seller-1', dto);
      expect(result).toEqual(mockProduct);
      expect(mockPrisma.product.create).toHaveBeenCalledWith({
        data: { ...dto, sellerId: 'seller-1' },
      });
    });
  });

  describe('findAll', () => {
    it('should return only active products by default', async () => {
      mockPrisma.product.findMany.mockResolvedValue([mockProduct]);
      const result = await service.findAll();
      expect(result).toEqual([mockProduct]);
      expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
    });

    it('should return all products when onlyActive=false', async () => {
      mockPrisma.product.findMany.mockResolvedValue([mockProduct]);
      await service.findAll(false);
      expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });
  });

  describe('findById', () => {
    it('should throw NotFoundException if product not found', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(null);
      await expect(service.findById('bad-id')).rejects.toThrow(NotFoundException);
    });

    it('should return product with seller info', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(mockProduct);
      const result = await service.findById('prod-1');
      expect(result).toEqual(mockProduct);
      expect(result.seller).toBeDefined();
    });
  });

  describe('update', () => {
    const updateDto = { title: 'Updated Title' };

    it('should throw NotFoundException if product not found', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(null);
      await expect(service.update('bad-id', 'seller-1', updateDto)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if not owner', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(mockProduct);
      await expect(service.update('prod-1', 'other-seller', updateDto)).rejects.toThrow(ForbiddenException);
    });

    it('should update product if owner', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(mockProduct);
      mockPrisma.product.update.mockResolvedValue({ ...mockProduct, title: 'Updated Title' });
      const result = await service.update('prod-1', 'seller-1', updateDto);
      expect(result.title).toBe('Updated Title');
    });
  });

  describe('remove', () => {
    it('should throw ForbiddenException if not owner', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(mockProduct);
      await expect(service.remove('prod-1', 'other-seller')).rejects.toThrow(ForbiddenException);
    });

    it('should soft-delete (set isActive=false) if owner', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(mockProduct);
      mockPrisma.product.update.mockResolvedValue({ ...mockProduct, isActive: false });
      const result = await service.remove('prod-1', 'seller-1');
      expect(result.isActive).toBe(false);
    });
  });

  describe('findAllAdmin', () => {
    it('should return paginated products', async () => {
      mockPrisma.product.findMany.mockResolvedValue([mockProduct]);
      mockPrisma.product.count.mockResolvedValue(1);
      const result = await service.findAllAdmin({ page: 1, limit: 10 });
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should filter by status=active', async () => {
      mockPrisma.product.findMany.mockResolvedValue([]);
      mockPrisma.product.count.mockResolvedValue(0);
      await service.findAllAdmin({ status: 'active' });
      expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
    });

    it('should filter by status=hidden', async () => {
      mockPrisma.product.findMany.mockResolvedValue([]);
      mockPrisma.product.count.mockResolvedValue(0);
      await service.findAllAdmin({ status: 'hidden' });
      expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: false } }),
      );
    });
  });

  describe('toggleActive', () => {
    it('should toggle product active status', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(mockProduct);
      mockPrisma.product.update.mockResolvedValue({ ...mockProduct, isActive: false });
      const result = await service.toggleActive('prod-1');
      expect(result.isActive).toBe(false);
    });
  });

  describe('deleteProduct', () => {
    it('should delete product and related data', async () => {
      mockPrisma.order.findMany.mockResolvedValue([{ id: 'order-1' }]);
      mockPrisma.transaction.deleteMany.mockResolvedValue({});
      mockPrisma.order.deleteMany.mockResolvedValue({});
      mockPrisma.product.delete.mockResolvedValue(mockProduct);
      await service.deleteProduct('prod-1');
      expect(mockPrisma.transaction.deleteMany).toHaveBeenCalled();
      expect(mockPrisma.order.deleteMany).toHaveBeenCalled();
      expect(mockPrisma.product.delete).toHaveBeenCalled();
    });

    it('should delete product without related orders', async () => {
      mockPrisma.order.findMany.mockResolvedValue([]);
      mockPrisma.product.delete.mockResolvedValue(mockProduct);
      await service.deleteProduct('prod-1');
      expect(mockPrisma.transaction.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('findBySeller', () => {
    it('should return products for a seller', async () => {
      mockPrisma.product.findMany.mockResolvedValue([mockProduct]);
      const result = await service.findBySeller('seller-1');
      expect(result).toHaveLength(1);
    });
  });
});
