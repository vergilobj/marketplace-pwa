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
    verifyLegacyIpnPayment: jest.fn(),
    getAllTransactions: jest.fn(),
    getOrderPaymentStatus: jest.fn(),
    getOrderPayAddress: jest.fn(),
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
    // clearAllMocks сбрасывает реализации — восстанавливаем дефолты.
    mockNowPayments.verifyIpnSignature.mockReturnValue(true);
    mockNowPayments.extractOrderId.mockReturnValue('order-1');
    service.verifyLegacyIpnPayment.mockResolvedValue({ ok: true });
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

  // F2: контроллер обязан передать личность читателя в сервис — иначе
  // owner-чек не включится и IDOR вернётся.
  describe('F2: owner-чек прокидывается в сервис', () => {
    const req: any = { user: { userId: 'u-1', role: 'BUYER' } };

    it('getOrderStatus передаёт viewer', async () => {
      service.getOrderPaymentStatus.mockResolvedValue({ status: 'PENDING' });
      await controller.getOrderStatus('order-1', req);
      expect(service.getOrderPaymentStatus).toHaveBeenCalledWith('order-1', {
        userId: 'u-1',
        role: 'BUYER',
      });
    });

    it('getOrderPay передаёт viewer', async () => {
      service.getOrderPayAddress.mockResolvedValue({ depositAddress: '0x' });
      await controller.getOrderPay('order-1', req);
      expect(service.getOrderPayAddress).toHaveBeenCalledWith('order-1', {
        userId: 'u-1',
        role: 'BUYER',
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
      // NH7: без успешной сверки суммы заказ НЕ подтверждается.
      service.verifyLegacyIpnPayment.mockResolvedValue({ ok: true });
      const body = { order_id: 'order-1', payment_status: 'finished' };
      await controller.handleIpn(body, 'valid-sig');
      expect(service.processSuccessfulPayment).toHaveBeenCalledWith('order-1');
    });

    /**
     * NH7: legacy NowPayments IPN подтверждал заказ без сверки суммы —
     * легаси-заказ можно было закрыть на неполную оплату (та же дыра, что B7,
     * но в старом провайдере). Теперь сумма сверяется, и при недоплате
     * processSuccessfulPayment НЕ вызывается.
     */
    it('NH7: НЕ подтверждает заказ, если сумма не сошлась', async () => {
      mockNowPayments.verifyIpnSignature.mockReturnValue(true);
      service.verifyLegacyIpnPayment.mockResolvedValue({
        ok: false,
        reason: 'underpaid:expected=100,paid=10',
      });
      const body = {
        order_id: 'order-1',
        payment_status: 'finished',
        price_amount: 10,
      };
      const result = await controller.handleIpn(body, 'valid-sig');
      expect(service.verifyLegacyIpnPayment).toHaveBeenCalled();
      expect(service.processSuccessfulPayment).not.toHaveBeenCalled();
      expect(result).toMatchObject({ confirmed: false });
    });

    it('NH7: НЕ подтверждает заказ без order_id (деньги без привязки)', async () => {
      mockNowPayments.verifyIpnSignature.mockReturnValue(true);
      mockNowPayments.extractOrderId.mockReturnValue(null);
      const result = await controller.handleIpn(
        { payment_status: 'finished' },
        'valid-sig',
      );
      expect(service.processSuccessfulPayment).not.toHaveBeenCalled();
      expect(result).toEqual({ status: 'ok' });
    });
  });
});
