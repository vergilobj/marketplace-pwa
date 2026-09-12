/**
 * A3/B1: cart-aware платёж (один QR на всю корзину).
 *
 * Проверяем то, что нельзя проверить одним живым прогоном:
 *  - идемпотентность и детерминированный clientRef;
 *  - отказ на чужой/оплаченный/рекламный заказ;
 *  - порядок «сначала холд каждого заказа, потом фиксация Transaction»;
 *  - недоплата на уровне корзины не переводит НИ ОДИН заказ в PAID;
 *  - терминальный (отменённый кроном) заказ → доля на AVAILABLE (orphan);
 *  - не-якорный заказ видит статус общей транзакции.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NowPaymentsProvider } from './nowpayments.provider';
import { PaymodProvider } from './paymod.provider';
import { PaymodService } from './paymod.service';
import { LedgerService } from './ledger.service';
import { EscrowService } from './escrow.service';
import { cartClientRef } from './cart.util';

const WEI = 10n ** 18n;

describe('PaymentsService — cart-aware (A3/B1)', () => {
  let service: PaymentsService;
  let prisma: any;

  const orders = [
    { id: 'ord-a', amount: 100, status: 'PENDING', buyerId: 'buyer-1', post: null },
    { id: 'ord-b', amount: 200, status: 'PENDING', buyerId: 'buyer-1', post: null },
    { id: 'ord-c', amount: 300, status: 'PENDING', buyerId: 'buyer-1', post: null },
  ];

  const mockPrisma = {
    order: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    transaction: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    $transaction: jest.fn((fn: any) => fn(mockPrisma)),
  };

  const mockSettings = {
    get: jest.fn().mockResolvedValue('paymod'),
    getFloat: jest.fn().mockResolvedValue(1),
  };
  const mockPaymod = {
    createPayment: jest.fn(),
  };
  const mockEscrow = {
    holdForOrder: jest.fn(),
  };
  const mockLedger = {
    credit: jest.fn().mockResolvedValue({ applied: [], skipped: [] }),
  };
  const mockNotifications = { createNotification: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SettingsService, useValue: mockSettings },
        { provide: NowPaymentsProvider, useValue: {} },
        { provide: PaymodProvider, useValue: mockPaymod },
        { provide: PaymodService, useValue: {} },
        { provide: LedgerService, useValue: mockLedger },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: EscrowService, useValue: mockEscrow },
      ],
    }).compile();
    service = module.get<PaymentsService>(PaymentsService);
    prisma = mockPrisma;

    jest.clearAllMocks();
    mockSettings.get.mockResolvedValue('paymod');
    mockSettings.getFloat.mockResolvedValue(1);
    mockPaymod.createPayment.mockResolvedValue({
      success: true,
      transactionId: 'mp-cart-x',
      status: 'pending',
      raw: { deposit_address: '0xcart', client_ref: 'mp-cart-x' },
    });
    mockPrisma.transaction.create.mockResolvedValue({});
    mockPrisma.transaction.findUnique.mockResolvedValue(null);
    mockPrisma.transaction.findFirst.mockResolvedValue(null);
  });

  describe('createPaymentForCart', () => {
    it('меньше 2 заказов → 400 (для одного есть старый путь)', async () => {
      await expect(
        service.createPaymentForCart(['ord-a'], 'buyer-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('создаёт ОДНУ транзакцию на корзину с payload.cart и суммой из БД', async () => {
      mockPrisma.order.findMany.mockResolvedValue(orders);
      const res = await service.createPaymentForCart(
        ['ord-a', 'ord-b', 'ord-c'],
        'buyer-1',
      );

      expect(res.amount).toBe(600);
      expect(res.depositAddress).toBe('0xcart');
      expect(res.clientRef).toBe(cartClientRef(['ord-a', 'ord-b', 'ord-c']));
      expect(mockPrisma.transaction.create).toHaveBeenCalledTimes(1);

      const data = mockPrisma.transaction.create.mock.calls[0][0].data;
      expect(data.orderId).toBe('ord-a'); // anchor = min id
      expect(data.clientRef).toBe('mp-cart-' + data.clientRef.slice(8));
      expect(data.clientRef.startsWith('mp-cart-')).toBe(true);
      expect(data.expectedAmountRaw).toBe((600n * WEI).toString());
      expect(data.payload.cart.orderIds).toEqual(['ord-a', 'ord-b', 'ord-c']);
      expect(data.payload.cart.total).toBe(600);
      expect(data.payload.cart.perOrder).toEqual([
        { orderId: 'ord-a', amount: 100 },
        { orderId: 'ord-b', amount: 200 },
        { orderId: 'ord-c', amount: 300 },
      ]);
    });

    it('clientRef детерминирован: порядок orderIds не важен', async () => {
      mockPrisma.order.findMany.mockResolvedValue(orders);
      await service.createPaymentForCart(['ord-c', 'ord-a', 'ord-b'], 'buyer-1');
      expect(mockPrisma.transaction.create.mock.calls[0][0].data.clientRef).toBe(
        cartClientRef(['ord-a', 'ord-b', 'ord-c']),
      );
    });

    it('идемпотентен: существующая корзина → тот же адрес, без новой строки', async () => {
      mockPrisma.order.findMany.mockResolvedValue(orders);
      mockPrisma.transaction.findUnique.mockResolvedValue({
        depositAddress: '0xexisting',
        clientRef: cartClientRef(['ord-a', 'ord-b', 'ord-c']),
        amount: 600,
        status: 'PENDING',
      });
      const res = await service.createPaymentForCart(
        ['ord-a', 'ord-b', 'ord-c'],
        'buyer-1',
      );
      expect(res.depositAddress).toBe('0xexisting');
      expect(mockPrisma.transaction.create).not.toHaveBeenCalled();
      expect(mockPaymod.createPayment).not.toHaveBeenCalled();
    });

    it('чужой заказ → 403', async () => {
      mockPrisma.order.findMany.mockResolvedValue([
        orders[0],
        { ...orders[1], buyerId: 'someone-else' },
      ]);
      await expect(
        service.createPaymentForCart(['ord-a', 'ord-b'], 'buyer-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.transaction.create).not.toHaveBeenCalled();
    });

    it('не-PENDING заказ → 409', async () => {
      mockPrisma.order.findMany.mockResolvedValue([
        orders[0],
        { ...orders[1], status: 'PAID' },
      ]);
      await expect(
        service.createPaymentForCart(['ord-a', 'ord-b'], 'buyer-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('рекламный заказ → 400 (NH10: у рекламы свой путь оплаты)', async () => {
      mockPrisma.order.findMany.mockResolvedValue([
        orders[0],
        { ...orders[1], post: { isAd: true } },
      ]);
      await expect(
        service.createPaymentForCart(['ord-a', 'ord-b'], 'buyer-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('несуществующий заказ → 404, транзакция не создаётся', async () => {
      mockPrisma.order.findMany.mockResolvedValue([orders[0]]);
      await expect(
        service.createPaymentForCart(['ord-a', 'ord-b'], 'buyer-1'),
      ).rejects.toThrow('Часть заказов не найдена');
      expect(mockPrisma.transaction.create).not.toHaveBeenCalled();
    });
  });

  describe('getOrderPaymentStatus (cart-aware)', () => {
    it('не-якорный заказ видит общую транзакцию корзины', async () => {
      mockPrisma.transaction.findFirst
        .mockResolvedValueOnce(null) // личной нет
        .mockResolvedValueOnce({
          status: 'CONFIRMED',
          depositAddress: '0xcart',
          txHash: '0xtx',
        });
      const res = await service.getOrderPaymentStatus('ord-b');
      expect(res.status).toBe('CONFIRMED');
      expect(res.depositAddress).toBe('0xcart');
    });

    it('статус личной транзакции не перебивает cart (якорь — остаток PENDING)', async () => {
      // Личная PENDING-транзакция якоря + подтверждённая корзина.
      mockPrisma.transaction.findFirst
        .mockResolvedValueOnce({
          status: 'CONFIRMED',
          depositAddress: '0xcart',
          txHash: '0xtx',
        })
        .mockResolvedValueOnce({
          status: 'PENDING',
          depositAddress: '0xpersonal',
          txHash: null,
        });
      const res = await service.getOrderPaymentStatus('ord-a');
      expect(res.status).toBe('CONFIRMED');
      expect(res.depositAddress).toBe('0xcart');
    });

    it('OVERPAID корзины отдаётся фронту как CONFIRMED', async () => {
      mockPrisma.transaction.findFirst
        .mockResolvedValueOnce({
          status: 'OVERPAID',
          depositAddress: '0xcart',
          txHash: '0xtx',
        })
        .mockResolvedValueOnce(null);
      const res = await service.getOrderPaymentStatus('ord-b');
      expect(res.status).toBe('CONFIRMED');
    });

    it('нет транзакций → PENDING', async () => {
      mockPrisma.transaction.findFirst.mockResolvedValue(null);
      const res = await service.getOrderPaymentStatus('ord-x');
      expect(res).toEqual({
        status: 'PENDING',
        depositAddress: null,
        txHash: null,
      });
    });
  });

  describe('processSuccessfulCartPayment', () => {
    it('полная оплата → КАЖДЫЙ заказ PAID + холд на СВОЙ amount', async () => {
      mockPrisma.order.findMany.mockResolvedValue(orders);
      mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });
      mockEscrow.holdForOrder.mockResolvedValue({ held: true, amount: 0 });

      const res = await service.processSuccessfulCartPayment(
        ['ord-a', 'ord-b', 'ord-c'],
        600n * WEI,
        18,
      );

      expect(res.paid).toBe(3);
      expect(res.orphaned).toBe(0);
      expect(res.overpaid).toBe(false);
      // Холд вызван ПО КАЖДОМУ заказу отдельно — математика эскроу не тронута.
      expect(mockEscrow.holdForOrder.mock.calls.map((c) => c[0])).toEqual([
        'ord-a',
        'ord-b',
        'ord-c',
      ]);
      expect(mockPrisma.order.updateMany).toHaveBeenCalledTimes(3);
      // Никаких сводных проводок по корзине.
      expect(mockLedger.credit).not.toHaveBeenCalled();
    });

    it('недоплата → НИ ОДИН заказ не переводится в PAID', async () => {
      mockPrisma.order.findMany.mockResolvedValue(orders);

      const res = await service.processSuccessfulCartPayment(
        ['ord-a', 'ord-b', 'ord-c'],
        300n * WEI, // половина
        18,
      );

      expect(res.paid).toBe(0);
      expect(mockPrisma.order.updateMany).not.toHaveBeenCalled();
      expect(mockEscrow.holdForOrder).not.toHaveBeenCalled();
    });

    it('переплата → все PAID + разница на AVAILABLE покупателя', async () => {
      mockPrisma.order.findMany.mockResolvedValue(orders);
      mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });
      mockEscrow.holdForOrder.mockResolvedValue({ held: true, amount: 0 });

      const res = await service.processSuccessfulCartPayment(
        ['ord-a', 'ord-b', 'ord-c'],
        650n * WEI,
        18,
      );

      expect(res.overpaid).toBe(true);
      expect(mockLedger.credit).toHaveBeenCalledWith(
        null,
        expect.objectContaining({
          account: 'AVAILABLE',
          amount: 50,
          type: 'deposit_overpay',
          userId: 'buyer-1',
        }),
      );
    });

    it('отменённый кроном заказ → доля на AVAILABLE как orphan_deposit', async () => {
      mockPrisma.order.findMany.mockResolvedValue([
        orders[0],
        { ...orders[1], status: 'CANCELLED' },
      ]);

      const res = await service.processSuccessfulCartPayment(
        ['ord-a', 'ord-b'],
        300n * WEI,
        18,
      );

      expect(res.paid).toBe(1);
      expect(res.orphaned).toBe(1);
      expect(mockLedger.credit).toHaveBeenCalledWith(
        null,
        expect.objectContaining({
          account: 'AVAILABLE',
          amount: 200, // доля ИМЕННО отменённого заказа, не вся корзина
          type: 'orphan_deposit',
          refKey: 'orphan_deposit:cart-order:ord-b',
        }),
      );
    });

    it('падение холда → компенсация в PENDING и исключение наверх (ретрай)', async () => {
      mockPrisma.order.findMany.mockResolvedValue([orders[0], orders[1]]);
      mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });
      mockEscrow.holdForOrder.mockRejectedValue(new Error('db down'));

      await expect(
        service.processSuccessfulCartPayment(['ord-a', 'ord-b'], 300n * WEI, 18),
      ).rejects.toThrow('db down');

      // Компенсация: статус возвращён в PENDING, деньги не зачислены.
      expect(mockPrisma.order.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ord-a', status: 'PAID', escrowStatus: 'NONE' },
          data: { status: 'PENDING', paidAt: null },
        }),
      );
      expect(mockLedger.credit).not.toHaveBeenCalled();
    });

    it('идемпотентность: уже PAID заказы не холдируются повторно', async () => {
      mockPrisma.order.findMany.mockResolvedValue([
        { ...orders[0], status: 'PAID' },
        { ...orders[1], status: 'PAID' },
      ]);

      const res = await service.processSuccessfulCartPayment(
        ['ord-a', 'ord-b'],
        300n * WEI,
        18,
      );

      expect(res.paid).toBe(0);
      expect(mockPrisma.order.updateMany).not.toHaveBeenCalled();
      expect(mockEscrow.holdForOrder).not.toHaveBeenCalled();
    });
  });

  describe('payOrderAsBuyer (cart-aware)', () => {
    it('не-якорный заказ возвращает адрес корзины, а не личный', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: 'ord-b',
        buyerId: 'buyer-1',
        amount: 200,
        status: 'PENDING',
      });
      mockPrisma.transaction.findFirst
        .mockResolvedValueOnce(null) // личной PAYMOD-транзакции нет
        .mockResolvedValueOnce({
          depositAddress: '0xcart',
          clientRef: 'mp-cart-x',
          amount: 600,
          status: 'PENDING',
        });

      const res = await service.payOrderAsBuyer('ord-b', 'buyer-1');
      expect(res.depositAddress).toBe('0xcart');
      expect((res as any).cart).toBe(true);
    });
  });
});

describe('cartClientRef', () => {
  it('детерминирован и не зависит от порядка', () => {
    expect(cartClientRef(['b', 'a'])).toBe(cartClientRef(['a', 'b']));
    expect(cartClientRef(['a', 'b'])).toMatch(/^mp-cart-[0-9a-f]{16}$/);
  });

  it('разные корзины → разные ключи', () => {
    expect(cartClientRef(['a', 'b'])).not.toBe(cartClientRef(['a', 'c']));
  });
});