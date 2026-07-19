import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

describe('PaymentsController', () => {
  let controller: PaymentsController;
  let service: any;

  const mockService = {
    createPaymentForOrder: jest.fn(),
    processSuccessfulPayment: jest.fn(),
    getAllTransactions: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [{ provide: PaymentsService, useValue: mockService }],
    }).compile();
    controller = module.get<PaymentsController>(PaymentsController);
    service = mockService;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('processPayment', () => {
    it('should process payment', async () => {
      const result = await controller.processPayment('order-1');
      expect(result.message).toBe('Payment processed');
      expect(service.createPaymentForOrder).toHaveBeenCalledWith('order-1');
      expect(service.processSuccessfulPayment).toHaveBeenCalledWith('order-1');
    });
  });

  describe('getTransactions', () => {
    it('should return filtered transactions', async () => {
      service.getAllTransactions.mockResolvedValue({ items: [], total: 0 });
      await controller.getTransactions('payment', '', '1', '10');
      expect(service.getAllTransactions).toHaveBeenCalledWith({
        type: 'payment',
        orderSearch: '',
        page: 1,
        limit: 10,
      });
    });

    it('should use defaults for missing params', async () => {
      service.getAllTransactions.mockResolvedValue({ items: [], total: 0 });
      await controller.getTransactions();
      expect(service.getAllTransactions).toHaveBeenCalledWith({
        type: undefined,
        orderSearch: undefined,
        page: 1,
        limit: 20,
      });
    });
  });
});
