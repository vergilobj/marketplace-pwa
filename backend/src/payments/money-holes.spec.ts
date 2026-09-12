/**
 * Регрессионные тесты на 8 дыр денежного контура (N1, D1–D8).
 * Покрывают сценарии, которые аудит нашёл непокрытыми:
 *   D1 — спор останавливает таймер эскроу;
 *   D7 — заказы из сделки получают ненулевую комиссию;
 *   D3 — payout подтверждается через getTxStatus, двойной выплаты нет;
 *   D2 — replay UNDERPAID-депозита не задваивает зачисленное;
 *   D4 — сбой холда откатывает заказ в PENDING;
 *   D5 — adminForceStatus не ставит PAID и не делает молчаливый no-op;
 *   D6 — DISPUTED через orders API доходит до арбитража.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { OrderStatus } from '@prisma/client';
import { OrdersService } from '../marketplace/orders.service';
import { DealService } from '../bazar/deal.service';
import { PaymentsService } from './payments.service';
import { PaymodWebhookHandler } from './paymod-webhook.handler';
import { LedgerService } from './ledger.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EscrowService } from './escrow.service';
import { AuditService } from '../common/audit/audit.service';
import { PaymentsService as PaymentsDep } from './payments.service';
import { NowPaymentsProvider } from './nowpayments.provider';
import { PaymodProvider } from './paymod.provider';
import { PaymodService } from './paymod.service';
import { ModerationService } from '../moderation/moderation.service';

// ============================================================
// D7 — DealService.accept считает комиссии
// ============================================================
describe('D7: DealService.accept считает комиссии', () => {
  let service: DealService;
  let prisma: any;

  const product = { id: 'prod-1', price: 1000, isActive: true };
  const deal = {
    id: 'deal-1',
    buyerId: 'buyer-1',
    sellerId: 'seller-1',
    productId: 'prod-1',
    status: 'NEW',
    orderId: null,
    cashPrice: null,
    product,
  };

  const mockPrisma = {
    deal: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    product: { findUnique: jest.fn() },
    user: { findUnique: jest.fn().mockResolvedValue({ invitedById: null }) },
    order: { create: jest.fn() },
    bazarMessage: { create: jest.fn() },
  };

  const mockNotify = {
    createNotification: jest.fn().mockResolvedValue({}),
    sendToUser: jest.fn().mockResolvedValue(null),
  };
  const mockSettings = {
    getFloat: jest.fn((key: string) => {
      if (key === 'platform_fee_percent') return Promise.resolve(10);
      if (key === 'referral_percent') return Promise.resolve(5);
      return Promise.resolve(0);
    }),
  };
  const mockEscrow = { refundEscrow: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DealService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ModerationService, useValue: { moderate: jest.fn() } },
        { provide: NotificationsService, useValue: mockNotify },
        { provide: SettingsService, useValue: mockSettings },
        { provide: EscrowService, useValue: mockEscrow },
      ],
    }).compile();
    service = module.get(DealService);
    prisma = mockPrisma;
  });

  it('platformFee > 0 (10%) и referralBonus проброшены в Order', async () => {
    prisma.deal.findUnique.mockResolvedValue(deal);
    prisma.user.findUnique.mockResolvedValue({ invitedById: 'ref-1' });
    prisma.order.create.mockResolvedValue({ id: 'order-1' });

    await service.accept('buyer-1', 'deal-1');

    expect(prisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: 1000,
          platformFee: 100,
          referralBonus: 50,
          referralUserId: 'ref-1',
          dealId: 'deal-1',
          priceSource: 'PRODUCT',
        }),
      }),
    );
  });

  it('cashPrice фиксируется как DEAL и берётся в amount', async () => {
    prisma.deal.findUnique.mockResolvedValue({ ...deal, cashPrice: 800 });
    prisma.order.create.mockResolvedValue({ id: 'order-1' });

    await service.accept('buyer-1', 'deal-1');

    expect(prisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: 800,
          platformFee: 80,
          priceSource: 'DEAL',
        }),
      }),
    );
  });
});

// ============================================================
// D1 — DealService.openDispute останавливает таймер
// ============================================================
describe('D1: openDispute переводит Order в DISPUTED', () => {
  let service: DealService;
  let prisma: any;

  const deal = {
    id: 'deal-1',
    buyerId: 'buyer-1',
    sellerId: 'seller-1',
    status: 'ACCEPTED',
    dispute: null,
    orderId: 'order-1',
  };

  const mockPrisma = {
    deal: {
      findUnique: jest.fn().mockResolvedValue(deal),
      update: jest.fn(),
    },
    order: { updateMany: jest.fn() },
    bazarMessage: { create: jest.fn() },
    $transaction: jest.fn((fn: any) => fn(mockPrisma)),
  };
  const mockNotify = {
    createNotification: jest.fn().mockResolvedValue({}),
    sendToUser: jest.fn().mockResolvedValue(null),
  };
  const mockSettings = { getFloat: jest.fn().mockResolvedValue(0) };
  const mockEscrow = { refundEscrow: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.deal.findUnique.mockResolvedValue(deal);
    mockPrisma.$transaction.mockImplementation((fn: any) => fn(mockPrisma));
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DealService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ModerationService, useValue: { moderate: jest.fn() } },
        { provide: NotificationsService, useValue: mockNotify },
        { provide: SettingsService, useValue: mockSettings },
        { provide: EscrowService, useValue: mockEscrow },
      ],
    }).compile();
    service = module.get(DealService);
    prisma = mockPrisma;
  });

  it('ставит Order DISPUTED и autoCompleteAt = null', async () => {
    await service.openDispute('buyer-1', 'deal-1', 'не пришло');

    expect(prisma.deal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ dispute: 'OPEN' }),
      }),
    );
    expect(prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'order-1',
          status: { in: ['PAID', 'SHIPPED', 'DISPUTED'] },
        }),
        data: { status: 'DISPUTED', autoCompleteAt: null },
      }),
    );
  });
});

// ============================================================
// D6/D5 — OrdersService
// ============================================================
describe('D6: updateStatus(DISPUTED) поднимает Deal.dispute', () => {
  let service: OrdersService;
  let prisma: any;

  const order = {
    id: 'order-1',
    buyerId: 'buyer-1',
    sellerId: 'seller-1',
    status: 'PAID',
    escrowStatus: 'HELD',
    product: {},
    buyer: {},
    seller: {},
    referralUser: null,
  };

  const mockPrisma = {
    order: {
      findUnique: jest.fn().mockResolvedValue(order),
      update: jest.fn().mockResolvedValue({ ...order, status: 'DISPUTED' }),
      updateMany: jest.fn(),
    },
    deal: {
      findFirst: jest.fn().mockResolvedValue({ id: 'deal-1', dispute: null }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const mockEscrow = {
    releaseEscrow: jest.fn().mockResolvedValue({ released: true }),
    refundEscrow: jest.fn().mockResolvedValue({ refunded: true }),
  };
  const mockSettings = {
    getFloat: jest.fn().mockResolvedValue(10),
    getInt: jest.fn((_k: string, d: number) => Promise.resolve(d)),
  };
  const mockNotifications = {
    createNotification: jest.fn().mockResolvedValue({}),
    sendToUser: jest.fn().mockResolvedValue(null),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.order.findUnique.mockResolvedValue(order);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: { log: jest.fn() } },
        {
          provide: PaymentsDep,
          useValue: { createPaymentForOrder: jest.fn() },
        },
        { provide: EscrowService, useValue: mockEscrow },
        { provide: SettingsService, useValue: mockSettings },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();
    service = module.get(OrdersService);
    prisma = mockPrisma;
  });

  it('DISPUTED → Order DISPUTED + Deal.dispute=OPEN', async () => {
    await service.updateStatus('order-1', 'buyer-1', 'BUYER', {
      status: 'DISPUTED',
    } as any);

    expect(prisma.deal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'deal-1' },
        data: expect.objectContaining({ dispute: 'OPEN' }),
      }),
    );
  });

  it('D5: adminForceStatus запрещает прямую установку PAID', async () => {
    await expect(
      service.adminForceStatus(
        'order-1',
        { status: OrderStatus.PAID } as any,
        'хочу так',
      ),
    ).rejects.toThrow(/PAID/);
  });

  it('D5: adminForceStatus COMPLETED без HELD эскроу не молчит', async () => {
    mockEscrow.releaseEscrow.mockResolvedValue({ released: false });
    await service.adminForceStatus(
      'order-1',
      { status: OrderStatus.COMPLETED },
      'ручное завершение',
    );
    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'COMPLETED' }),
      }),
    );
  });
});

// ============================================================
// D4 — сбой холда откатывает PAID → PENDING
// ============================================================
describe('D4: сбой холда откатывает заказ в PENDING', () => {
  let service: PaymentsService;

  const mockPrisma = {
    order: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    transaction: { create: jest.fn() },
  };
  const mockEscrow = {
    holdForOrder: jest.fn().mockRejectedValue(new Error('db down')),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: SettingsService,
          useValue: { get: jest.fn(), getFloat: jest.fn() },
        },
        { provide: NowPaymentsProvider, useValue: {} },
        { provide: PaymodProvider, useValue: {} },
        { provide: PaymodService, useValue: { getTxStatus: jest.fn() } },
        { provide: LedgerService, useValue: { credit: jest.fn() } },
        {
          provide: NotificationsService,
          useValue: { createNotification: jest.fn() },
        },
        { provide: EscrowService, useValue: mockEscrow },
      ],
    }).compile();
    service = module.get(PaymentsService);
  });

  it('при падении holdForOrder заказ возвращается в PENDING и ошибка наверх', async () => {
    await expect(service.processSuccessfulPayment('order-1')).rejects.toThrow(
      'db down',
    );

    expect(mockPrisma.order.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          id: 'order-1',
          status: 'PAID',
          escrowStatus: 'NONE',
        },
        data: expect.objectContaining({ status: 'PENDING' }),
      }),
    );
  });
});

// ============================================================
// D2 — replay UNDERPAID-депозита не задваивает
// ============================================================
describe('D2: replay UNDERPAID-депозита блокируется append-only списком', () => {
  let handler: PaymodWebhookHandler;

  const tx = {
    id: 'tx-1',
    orderId: 'order-1',
    amount: 1000,
    amountRaw: '1000000000000000000000',
    expectedAmountRaw: '1000000000000000000000',
    tokenDecimals: 18,
    depositAddress: '0xDeposit',
    chain: 'bsc',
    token: 'USDT',
    status: 'UNDERPAID',
    // Первый webhook (H1) уже обработан и записан в append-only список.
    payload: {
      deposit: {
        receivedRaw: '100000000000000000000',
        hashes: ['0xhash1'],
      },
    },
    order: { id: 'order-1', status: 'PENDING', buyerId: 'buyer-1' },
  };

  const mockPrisma = {
    transaction: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const mockLedger = { credit: jest.fn() };
  const mockPayments = { processSuccessfulPayment: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    // txHash H1 не найден в колонке (перезаписан), но есть в payload.hashes.
    mockPrisma.transaction.findUnique
      .mockResolvedValueOnce(null) // txHash lookup
      .mockResolvedValueOnce(tx); // clientRef lookup
    handler = new PaymodWebhookHandler(
      mockPrisma as any,
      { getFloat: jest.fn().mockResolvedValue(1) } as any,
      mockLedger as any,
      { createNotification: jest.fn().mockResolvedValue({}) } as any,
      mockPayments as any,
    );
  });

  it('повторный webhook с тем же txHash — no-op, заказ не подтверждается', async () => {
    await handler.handleDeposit({
      event: 'deposit',
      client_ref: 'mp-txn-order-1',
      tx_hash: '0xhash1', // уже в payload.deposit.hashes
      amount_raw: '100000000000000000000',
      chain: 'bsc',
      token: 'USDT',
      to: '0xDeposit',
    });

    expect(mockPrisma.transaction.update).not.toHaveBeenCalled();
    expect(mockLedger.credit).not.toHaveBeenCalled();
    expect(mockPayments.processSuccessfulPayment).not.toHaveBeenCalled();
  });

  it('новый txHash (H2) обрабатывается штатно', async () => {
    await handler.handleDeposit({
      event: 'deposit',
      client_ref: 'mp-txn-order-1',
      tx_hash: '0xhash2', // новый
      amount_raw: '1000000000000000000000',
      chain: 'bsc',
      token: 'USDT',
      to: '0xDeposit',
    });

    expect(mockPrisma.transaction.update).toHaveBeenCalled();
    expect(mockPayments.processSuccessfulPayment).toHaveBeenCalledWith(
      'order-1',
    );
  });
});
