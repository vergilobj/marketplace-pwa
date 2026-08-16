import { Test, TestingModule } from '@nestjs/testing';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

describe('OrdersController', () => {
  let controller: OrdersController;
  let service: any;

  const mockService = {
    create: jest.fn(),
    findMyOrders: jest.fn(),
    findById: jest.fn(),
    updateStatus: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [{ provide: OrdersService, useValue: mockService }],
    }).compile();
    controller = module.get<OrdersController>(OrdersController);
    service = mockService;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should create order', async () => {
      service.create.mockResolvedValue({ id: 'order-1' });
      const result = await controller.create(
        { user: { userId: 'buyer-1', role: 'BUYER' } },
        { productId: 'prod-1', amount: 100 },
      );
      expect(result.id).toBe('order-1');
      expect(service.create).toHaveBeenCalledWith(
        'buyer-1',
        expect.any(Object),
      );
    });
  });

  describe('findMyOrders', () => {
    it('should return orders filtered by status', async () => {
      service.findMyOrders.mockResolvedValue([]);
      await controller.findMyOrders(
        { user: { userId: 'u1', role: 'BUYER' } },
        'PAID',
      );
      expect(service.findMyOrders).toHaveBeenCalledWith('u1', 'BUYER', 'PAID');
    });
  });

  describe('findById', () => {
    it('should return order by id', async () => {
      service.findById.mockResolvedValue({ id: 'order-1' });
      expect(await controller.findById('order-1')).toEqual({ id: 'order-1' });
    });
  });

  describe('updateStatus', () => {
    it('should update order status', async () => {
      service.updateStatus.mockResolvedValue({
        id: 'order-1',
        status: 'SHIPPED',
      });
      const result = await controller.updateStatus(
        'order-1',
        { user: { userId: 's1', role: 'SELLER' } },
        { status: 'SHIPPED' },
      );
      expect(result.status).toBe('SHIPPED');
    });
  });
});
