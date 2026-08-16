import { Test, TestingModule } from '@nestjs/testing';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

describe('ProductsController', () => {
  let controller: ProductsController;
  let service: any;

  const mockService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    findAllAdmin: jest.fn(),
    toggleActive: jest.fn(),
    deleteProduct: jest.fn(),
    adminUpdate: jest.fn(),
    findBySeller: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [{ provide: ProductsService, useValue: mockService }],
    }).compile();
    controller = module.get<ProductsController>(ProductsController);
    service = mockService;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should create product', async () => {
      service.create.mockResolvedValue({ id: 'p1' });
      const result = await controller.create(
        { user: { userId: 'seller-1', role: 'SELLER' } },
        { title: 'T', description: 'D', price: 100 },
      );
      expect(result.id).toBe('p1');
      expect(service.create).toHaveBeenCalledWith(
        'seller-1',
        expect.any(Object),
      );
    });
  });

  describe('findAll', () => {
    it('should return products', async () => {
      service.findAll.mockResolvedValue([]);
      expect(await controller.findAll()).toEqual([]);
    });
  });

  describe('findById', () => {
    it('should return product', async () => {
      service.findById.mockResolvedValue({ id: 'p1' });
      expect(await controller.findById('p1')).toEqual({ id: 'p1' });
    });
  });

  describe('update', () => {
    it('should update product', async () => {
      service.update.mockResolvedValue({ id: 'p1', title: 'Updated' });
      const result = await controller.update(
        'p1',
        { user: { userId: 's1', role: 'SELLER' } },
        { title: 'Updated' },
      );
      expect(result.title).toBe('Updated');
    });
  });

  describe('remove', () => {
    it('should soft-delete product', async () => {
      service.remove.mockResolvedValue({ id: 'p1', isActive: false });
      const result = await controller.remove('p1', { user: { userId: 's1', role: 'SELLER' } });
      expect(result.isActive).toBe(false);
    });
  });

  describe('findAllAdmin', () => {
    it('should return admin product list', async () => {
      service.findAllAdmin.mockResolvedValue({ items: [], total: 0 });
      await controller.findAllAdmin('1', '10', '', 'active');
      expect(service.findAllAdmin).toHaveBeenCalledWith({
        page: 1,
        limit: 10,
        search: '',
        status: 'active',
      });
    });
  });

  describe('toggleActive', () => {
    it('should toggle active', async () => {
      service.toggleActive.mockResolvedValue({ id: 'p1', isActive: false });
      const result = await controller.toggleActive('p1');
      expect(result.isActive).toBe(false);
    });
  });

  describe('findMyProducts', () => {
    it('should return seller products', async () => {
      service.findBySeller.mockResolvedValue([{ id: 'p1' }]);
      const result = await controller.findMyProducts({
        user: { userId: 's1', role: 'SELLER' },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('deleteProduct', () => {
    it('should hard-delete product', async () => {
      service.deleteProduct.mockResolvedValue({ id: 'p1' });
      await controller.deleteProduct('p1');
      expect(service.deleteProduct).toHaveBeenCalledWith('p1');
    });
  });

  describe('adminUpdate', () => {
    it('should update product as admin', async () => {
      service.adminUpdate.mockResolvedValue({ id: 'p1' });
      await controller.adminUpdate('p1', { title: 'Admin Edit' });
      expect(service.adminUpdate).toHaveBeenCalledWith(
        'p1',
        expect.any(Object),
      );
    });
  });
});
