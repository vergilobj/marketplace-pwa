import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { NowPaymentsProvider } from './nowpayments.provider';

describe('PaymentsController', () => {
  let controller: PaymentsController;
  let service: any;

  const mockService = {
    createPaymentForOrder: jest.fn().mockResolvedValue({
      invoiceUrl: 'https://nowpayments.io/invoice/123',
      transactionId: 'tx-1',
      status: 'pending',
    }),
    processSuccessfulPayment: jest.fn(),
    getAllTransactions: jest.fn(),
  };

  const mockNowPayments = {
    verifyIpnSignature: jest.fn().mockReturnValue(true),
    extractOrderId: jest.fn().mockReturnValue('order-1'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        { provide: PaymentsService, useValue: mockService },
        { provide: NowPaymentsProvider, useValue: mockNowPayments },
      ],
    }).compile();
    controller = module.get<PaymentsController>(PaymentsController);
    service = mockService;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createInvoice', () => {
    it('should create invoice for order', async () => {
      const result = await controller.createInvoice('order-1');
      expect(result).toHaveProperty('invoiceUrl');
      expect(service.createPaymentForOrder).toHaveBeenCalledWith('order-1');
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

  describe('handleIpn', () => {
    it('should reject invalid signature', async () => {
      mockNowPayments.verifyIpnSignature.mockReturnValue(false);
      const result = await controller.handleIpn({}, 'bad-sig');
      expect(result).toEqual({ status: 'rejected', reason: 'invalid_signature' });
    });

    it('should process payment on finished status', async () => {
      mockNowPayments.verifyIpnSignature.mockReturnValue(true);
      const body = { order_id: 'order-1', payment_status: 'finished' };
      await controller.handleIpn(body, 'valid-sig');
      expect(service.processSuccessfulPayment).toHaveBeenCalledWith('order-1');
    });
  });
});
