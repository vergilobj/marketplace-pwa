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
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
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

    /**
     * F1: гонка на createPaymentForCart.
     *
     * Аудит AUD3 (flow4-race.json) воспроизвёл: два параллельных
     * POST /payments/cart/pay → 201 + 500 (P2002 по clientRef), фронт ловил
     * ошибку и деградировал к поштучной оплате → N QR вместо одного.
     */
    describe('F1: гонка create (P2002 по clientRef)', () => {
      const racedTx = {
        depositAddress: '0xwinner',
        clientRef: cartClientRef(['ord-a', 'ord-b']),
        amount: 300,
        status: 'PENDING',
      };

      it('проигравший гонку ловит P2002 и возвращает существующую транзакцию, а не падает', async () => {
        mockPrisma.order.findMany.mockResolvedValue(orders.slice(0, 2));

        // Прогрев: pre-check находит победителя.
        mockPrisma.transaction.findUnique.mockResolvedValueOnce(racedTx);
        const winner = await service.createPaymentForCart(
          ['ord-a', 'ord-b'],
          'buyer-1',
        );

        expect(winner.depositAddress).toBe('0xwinner');
        expect(winner.clientRef).toBe(cartClientRef(['ord-a', 'ord-b']));
        expect(winner.amount).toBe(300);
        expect(winner.status).toBe('PENDING');
        expect(mockPrisma.transaction.create).not.toHaveBeenCalled();

        // Гонка: pre-check пуст → create падает P2002 → ищем строку снова.
        mockPrisma.transaction.findUnique
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(racedTx);
        const p2002 = Object.assign(new Error('Unique constraint failed'), {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['clientRef'] },
        });
        mockPrisma.transaction.create.mockRejectedValueOnce(p2002);

        const loser = await service.createPaymentForCart(
          ['ord-a', 'ord-b'],
          'buyer-1',
        );

        // Никакого исключения наружу (было 500).
        expect(loser).toEqual({
          depositAddress: '0xwinner',
          clientRef: cartClientRef(['ord-a', 'ord-b']),
          amount: 300,
          status: 'PENDING',
        });
        // Форма ответа идентична успешному пути — CheckoutPage читает те же поля.
        expect(Object.keys(loser).sort()).toEqual(Object.keys(winner).sort());
      });

      it('два ПАРАЛЛЕЛЬНЫХ вызова: оба разрешаются, адрес один, в БД одна строка', async () => {
        const twoOrders = orders.slice(0, 2);
        mockPrisma.order.findMany.mockResolvedValue(twoOrders);

        const cartKey = cartClientRef(['ord-a', 'ord-b']);
        const stored: any[] = [];
        const p2002 = Object.assign(new Error('Unique constraint failed'), {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['clientRef'] },
        });

        // Гонка «по-настоящему»: барьер внутри create — оба вызова обязаны
        // дойти до вставки ДО того, как хоть один из них её выполнит.
        // Именно так ведёт себя UNIQUE(clientRef) в Postgres: второй insert
        // получает P2002 (pre-check к этому моменту уже пройден обоими).
        let arrived = 0;
        let releaseInsert!: () => void;
        const insertGate = new Promise<void>((r) => (releaseInsert = r));

        mockPrisma.transaction.create.mockImplementation(async (args: any) => {
          arrived++;
          if (arrived === 2) releaseInsert();
          await insertGate;

          if (stored.some((t) => t.clientRef === args.data.clientRef)) {
            throw p2002;
          }
          const row = {
            // Sidecar идемпотентен по client_ref → адрес детерминирован и
            // одинаков у обоих вызовов. Пишем ровно то, что записала бы БД.
            depositAddress: args.data.depositAddress,
            clientRef: args.data.clientRef,
            amount: args.data.amount,
            status: args.data.status,
            payload: args.data.payload,
          };
          stored.push(row);
          return row;
        });

        mockPrisma.transaction.findUnique.mockImplementation(async (args: any) => {
          return stored.find((t) => t.clientRef === args.where.clientRef) ?? null;
        });

        // Барьер: оба вызова гарантированно проходят pre-check ДО любого insert.
        let ready = 0;
        let releaseOrders!: () => void;
        const ordersGate = new Promise<void>((r) => (releaseOrders = r));
        mockPrisma.order.findMany.mockImplementation(async () => {
          ready++;
          if (ready === 2) releaseOrders();
          await ordersGate;
          return twoOrders;
        });

        const [r1, r2] = await Promise.all([
          service.createPaymentForCart(['ord-a', 'ord-b'], 'buyer-1'),
          service.createPaymentForCart(['ord-b', 'ord-a'], 'buyer-1'),
        ]);

        // Оба успешны, адрес и clientRef совпадают (адрес sidecar'а — '0xcart').
        expect(r1.depositAddress).toBe('0xcart');
        expect(r2.depositAddress).toBe('0xcart');
        expect(r1.clientRef).toBe(cartKey);
        expect(r2.clientRef).toBe(cartKey);
        // Ровно ОДНА строка на корзину.
        expect(stored).toHaveLength(1);
        expect(stored[0].payload.cart.orderIds).toEqual(['ord-a', 'ord-b']);

        // Снять барьер-реализацию, чтобы она не протекла в следующие тесты
        // (clearAllMocks чистит вызовы, но НЕ реализации).
        mockPrisma.order.findMany.mockResolvedValue(twoOrders);
      });

      it('P2002 не по clientRef (нет строки) → ошибка пробрасывается, а не глушится', async () => {
        mockPrisma.order.findMany.mockResolvedValue(orders.slice(0, 2));
        mockPrisma.transaction.findUnique.mockResolvedValue(null);
        mockPrisma.transaction.create.mockRejectedValue(
          Object.assign(new Error('Unique constraint failed'), {
            code: 'P2002',
            meta: { target: ['txHash'] },
          }),
        );
        await expect(
          service.createPaymentForCart(['ord-a', 'ord-b'], 'buyer-1'),
        ).rejects.toThrow('Unique constraint failed');
      });

      it('не-P2002 ошибка create → пробрасывается без изменений', async () => {
        mockPrisma.order.findMany.mockResolvedValue(orders.slice(0, 2));
        mockPrisma.transaction.findUnique.mockResolvedValue(null);
        mockPrisma.transaction.create.mockRejectedValue(new Error('db down'));
        await expect(
          service.createPaymentForCart(['ord-a', 'ord-b'], 'buyer-1'),
        ).rejects.toThrow('db down');
      });
    });

    /**
     * F1 (вторая гонка): сам sidecar тоже делает check-then-create
     * (`wallet_directory()` → `create_deposit_wallet()`), и его
     * `UNIQUE constraint failed: wallets.client_ref` прилетает как HTTP 500
     * → `paymod error: 500 ...`. Без ретрая это снова 500 на эндпоинте.
     */
    describe('F1: гонка в sidecar (paymod 500) → ретрай', () => {
      it('paymod 500 один раз → повтор даёт тот же адрес, вызов успешен', async () => {
        mockPrisma.order.findMany.mockResolvedValue(orders.slice(0, 2));
        mockPrisma.transaction.findUnique.mockResolvedValue(null);
        mockPrisma.transaction.create.mockResolvedValue({});

        mockPaymod.createPayment
          .mockRejectedValueOnce(
            new Error(
              'paymod error: 500 {"detail":"wallet creation failed: UNIQUE constraint failed: wallets.client_ref"}',
            ),
          )
          .mockResolvedValueOnce({
            success: true,
            transactionId: 'mp-cart-x',
            status: 'pending',
            raw: { deposit_address: '0xafterretry' },
          });

        const res = await service.createPaymentForCart(
          ['ord-a', 'ord-b'],
          'buyer-1',
        );

        expect(mockPaymod.createPayment).toHaveBeenCalledTimes(2);
        expect(res.depositAddress).toBe('0xafterretry');
        expect(mockPrisma.transaction.create).toHaveBeenCalledTimes(1);
      });

      it('paymod 500 все попытки → ошибка наружу (не глотаем бесконечно)', async () => {
        mockPrisma.order.findMany.mockResolvedValue(orders.slice(0, 2));
        mockPrisma.transaction.findUnique.mockResolvedValue(null);
        mockPaymod.createPayment.mockRejectedValue(
          new Error('paymod error: 500 boom'),
        );

        await expect(
          service.createPaymentForCart(['ord-a', 'ord-b'], 'buyer-1'),
        ).rejects.toThrow('paymod error: 500');
        expect(mockPaymod.createPayment).toHaveBeenCalledTimes(3);
        expect(mockPrisma.transaction.create).not.toHaveBeenCalled();
      });

      it('paymod 400 (осмысленный отказ) → НЕ ретраим', async () => {
        mockPrisma.order.findMany.mockResolvedValue(orders.slice(0, 2));
        mockPrisma.transaction.findUnique.mockResolvedValue(null);
        mockPaymod.createPayment.mockRejectedValue(
          new Error('paymod error: 400 bad client_ref'),
        );

        await expect(
          service.createPaymentForCart(['ord-a', 'ord-b'], 'buyer-1'),
        ).rejects.toThrow('paymod error: 400');
        expect(mockPaymod.createPayment).toHaveBeenCalledTimes(1);
      });

      it('сетевой сбой (fetch failed) → ретраим и восстанавливаемся', async () => {
        mockPrisma.order.findMany.mockResolvedValue(orders.slice(0, 2));
        mockPrisma.transaction.findUnique.mockResolvedValue(null);
        mockPrisma.transaction.create.mockResolvedValue({});

        mockPaymod.createPayment
          .mockRejectedValueOnce(new TypeError('fetch failed'))
          .mockResolvedValueOnce({
            success: true,
            transactionId: 'mp-cart-x',
            status: 'pending',
            raw: { deposit_address: '0xnet' },
          });

        const res = await service.createPaymentForCart(
          ['ord-a', 'ord-b'],
          'buyer-1',
        );
        expect(res.depositAddress).toBe('0xnet');
        expect(mockPaymod.createPayment).toHaveBeenCalledTimes(2);
      });
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

  /**
   * F2: IDOR на платёжных GET-эндпоинтах. До фикса оба метода отдавали
   * depositAddress/clientRef/статус по одному orderId любому авторизованному.
   * Политика — как в OrdersService.findById: buyer/seller/ADMIN.
   */
  describe('F2: owner-чек (viewer) на платежных данных', () => {
    const VIEWER = { userId: 'buyer-1', role: 'BUYER' };
    const STRANGER = { userId: 'buyer-2', role: 'BUYER' };
    const SELLER = { userId: 'seller-1', role: 'SELLER' };
    const ADMIN = { userId: 'admin-1', role: 'ADMIN' };

    beforeEach(() => {
      // Заказ из URL: buyer-1 покупатель, seller-1 продавец.
      mockPrisma.order.findUnique.mockResolvedValue({
        buyerId: 'buyer-1',
        sellerId: 'seller-1',
      });
      mockPrisma.transaction.findFirst.mockResolvedValue({
        status: 'CONFIRMED',
        depositAddress: '0xcart',
        txHash: '0xtx',
      });
    });

    it('status: чужой заказ → 403, транзакции не читаются', async () => {
      await expect(
        service.getOrderPaymentStatus('ord-a', STRANGER),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.transaction.findFirst).not.toHaveBeenCalled();
    });

    it('pay: чужой заказ → 403, depositAddress не отдаётся', async () => {
      await expect(
        service.getOrderPayAddress('ord-a', STRANGER),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.transaction.findFirst).not.toHaveBeenCalled();
    });

    it('status: владелец-покупатель → 200 c прежней формой ответа', async () => {
      const res = await service.getOrderPaymentStatus('ord-a', VIEWER);
      expect(res).toEqual({
        status: 'CONFIRMED',
        depositAddress: '0xcart',
        txHash: '0xtx',
      });
    });

    it('pay: владелец-покупатель → 200, поля depositAddress/clientRef', async () => {
      const res = await service.getOrderPayAddress('ord-a', VIEWER);
      expect(res).toEqual({ depositAddress: '0xcart', clientRef: undefined });
    });

    it('продавец заказа → 200 (та же политика, что /orders/:id)', async () => {
      const res = await service.getOrderPayAddress('ord-a', SELLER);
      expect(res.depositAddress).toBe('0xcart');
    });

    it('ADMIN → 200 на чужом заказе (обход, как в OrdersService.findById)', async () => {
      const res = await service.getOrderPayAddress('ord-a', ADMIN);
      expect(res.depositAddress).toBe('0xcart');
    });

    it('несуществующий заказ → 404', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);
      await expect(
        service.getOrderPayAddress('ord-ghost', VIEWER),
      ).rejects.toThrow(NotFoundException);
    });

    it('системный вызов без viewer → проверка не применяется', async () => {
      const res = await service.getOrderPaymentStatus('ord-a');
      expect(res.status).toBe('CONFIRMED');
      expect(mockPrisma.order.findUnique).not.toHaveBeenCalled();
    });

    /**
     * КРИТИЧНО (F1): заказ — НЕ-якорный участник корзины. Своей Transaction у
     * него нет, данные лежат в общей cart-транзакции. Владелец — buyerId
     * ЗАКАЗА ИЗ URL, поэтому чужой не должен получить данные корзины даже
     * если cart-транзакция на него «не похожа».
     */
    it('cart, не-якорный заказ: buyer видит общую транзакцию корзины', async () => {
      // findCartTransaction бьёт первым, потом personal-запрос.
      mockPrisma.transaction.findFirst
        .mockResolvedValueOnce({
          status: 'CONFIRMED',
          depositAddress: '0xcart',
          txHash: '0xtx',
        })
        .mockResolvedValueOnce(null);

      const res = await service.getOrderPaymentStatus('ord-b', VIEWER);
      expect(res.status).toBe('CONFIRMED');
      expect(res.depositAddress).toBe('0xcart');
    });

    it('cart, не-якорный заказ: чужой → 403 (cart-транзакция не ищется)', async () => {
      await expect(
        service.getOrderPaymentStatus('ord-b', STRANGER),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.transaction.findFirst).not.toHaveBeenCalled();
    });

    it('cart: чужой не получает адрес и через /pay', async () => {
      await expect(
        service.getOrderPayAddress('ord-b', STRANGER),
      ).rejects.toThrow(ForbiddenException);
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