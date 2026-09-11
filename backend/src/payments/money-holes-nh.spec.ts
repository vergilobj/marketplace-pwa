/**
 * Регрессионные тесты на критические дыры NH1–NH4, найденные ре-аудитом
 * (verify2/report.md) после закрытия D1–D8.
 *
 * NH1 — повторное списание вывода молча пропускается (деньги из воздуха);
 * NH2 — ретрай холда короткозамыкается дедупом (деньги покупателя зависают);
 * NH3 — adminForceStatus обходит матрицу (эскроу висит вечно);
 * NH4 — рассинхрон нумерации попыток reversal;
 * D3 (остаток) — lost-response double payout.
 *
 * Мокаем Prisma: логика целиком построена на порядке вызовов и на
 * результате ledger.apply, который здесь и проверяем.
 */
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { LedgerAccount, OrderStatus } from '@prisma/client';
import { UsersService } from '../users/users.service';
import { OrdersService } from '../marketplace/orders.service';
import { PaymentsService } from '../payments/payments.service';
import { PaymodWebhookHandler } from '../payments/paymod-webhook.handler';
import { PaymodService } from '../payments/paymod.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../common/audit/audit.service';
import { EscrowService } from '../payments/escrow.service';
import { LedgerService } from '../payments/ledger.service';
import { NowPaymentsProvider } from '../payments/nowpayments.provider';
import { PaymodProvider } from '../payments/paymod.provider';

// ============================================================
// NH1 — повторное списание вывода не пропускается молча
// ============================================================
describe('NH1: повторное списание вывода (деньги из воздуха)', () => {
  let service: UsersService;

  const mockPrisma = {
    withdrawalRequest: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    user: { findUnique: jest.fn() },
    $transaction: jest.fn((cb: any) => cb(mockPrisma)),
  };

  const mockLedger = {
    getBalances: jest.fn(),
    // Дефолт — проводка записалась.
    debit: jest
      .fn()
      .mockImplementation((_tx: any, p: any) =>
        Promise.resolve({ applied: [p.refKey], skipped: [] }),
      ),
    credit: jest.fn().mockResolvedValue({ applied: [], skipped: [] }),
  };

  const mockPaymod = {
    payout: jest
      .fn()
      .mockResolvedValue({ tx_hash: '0xabc', status: 'submitted' }),
    getPayout: jest.fn().mockResolvedValue(null),
  };

  const pendingRequest = {
    id: 'wr-1',
    userId: 'user-1',
    amount: 100,
    status: 'pending',
    toAddress: '0x' + 'a'.repeat(40),
    payoutAttempts: 0,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((cb: any) => cb(mockPrisma));
    mockPrisma.withdrawalRequest.update.mockResolvedValue({});
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      walletAddress: null,
      bonusBalance: 0,
    });
    mockPrisma.withdrawalRequest.findUniqueOrThrow.mockResolvedValue({
      id: 'wr-1',
      status: 'approved',
      payoutStatus: 'SUBMITTED',
    });
    mockLedger.getBalances.mockResolvedValue({
      availableBalance: 500,
      bonusBalance: 0,
      escrowBalance: 0,
      pendingEscrow: 0,
      totalWithdrawable: 500,
    });
    mockLedger.debit.mockImplementation((_tx: any, p: any) =>
      Promise.resolve({ applied: [p.refKey], skipped: [] }),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: NotificationsService, useValue: { createNotification: jest.fn() } },
        { provide: SettingsService, useValue: { getFloat: jest.fn() } },
        { provide: PaymodService, useValue: mockPaymod },
        { provide: LedgerService, useValue: mockLedger },
      ],
    }).compile();
    service = module.get(UsersService);
  });

  it('refKey дебета содержит номер попытки: attempt 1 и attempt 2 дают РАЗНЫЕ ключи', async () => {
    // Попытка 1
    mockPrisma.withdrawalRequest.findUnique.mockResolvedValueOnce({
      ...pendingRequest,
      payoutAttempts: 0,
    });
    await service.approveWithdrawal('wr-1');
    const firstKey = mockLedger.debit.mock.calls[0][1].refKey;

    // Попытка 2 — админ одобряет повторно после reversal.
    mockLedger.debit.mockClear();
    mockPrisma.withdrawalRequest.findUnique.mockResolvedValueOnce({
      ...pendingRequest,
      payoutAttempts: 1,
    });
    await service.approveWithdrawal('wr-1');
    const secondKey = mockLedger.debit.mock.calls[0][1].refKey;

    expect(firstKey).toBe('withdrawal_debit:wr-1:1:AVAILABLE');
    expect(secondKey).toBe('withdrawal_debit:wr-1:2:AVAILABLE');
    // Ключевое свойство NH1: ключи РАЗНЫЕ, иначе skipDuplicates съест второе
    // списание и выплата уйдёт без уменьшения баланса.
    expect(firstKey).not.toBe(secondKey);
  });

  it('проводка НЕ применилась (skipped) → payout НЕ отправляется, заявка → pending', async () => {
    mockPrisma.withdrawalRequest.findUnique.mockResolvedValue(pendingRequest);
    // Симулируем коллизию refKey: ledger вернул skipped вместо applied.
    mockLedger.debit.mockResolvedValue({
      applied: [],
      skipped: ['withdrawal_debit:wr-1:1:AVAILABLE'],
    });

    await expect(service.approveWithdrawal('wr-1')).rejects.toThrow(
      BadRequestException,
    );

    // Вторая линия защиты NH1: в сеть НЕ ушли.
    expect(mockPaymod.payout).not.toHaveBeenCalled();
    // Заявка возвращена в pending с диагностикой.
    expect(mockPrisma.withdrawalRequest.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'pending',
          payoutStatus: 'FAILED',
        }),
      }),
    );
    // Реверс НЕ делаем: списания не было, возвращать нечего.
    expect(mockLedger.credit).not.toHaveBeenCalled();
  });

  it('несколько проводок (AVAILABLE + REFERRAL): каждая с attempt в ключе', async () => {
    mockPrisma.withdrawalRequest.findUnique.mockResolvedValue(pendingRequest);
    mockLedger.getBalances.mockResolvedValue({
      availableBalance: 60,
      bonusBalance: 40,
      escrowBalance: 0,
      pendingEscrow: 0,
      totalWithdrawable: 100,
    });

    await service.approveWithdrawal('wr-1');

    const keys = mockLedger.debit.mock.calls.map((c) => c[1].refKey);
    expect(keys).toEqual([
      'withdrawal_debit:wr-1:1:AVAILABLE',
      'withdrawal_debit:wr-1:1:REFERRAL',
    ]);
  });

  it('apply-результат реально проверяется: одна из двух проводок skipped → aborted', async () => {
    mockPrisma.withdrawalRequest.findUnique.mockResolvedValue(pendingRequest);
    mockLedger.getBalances.mockResolvedValue({
      availableBalance: 60,
      bonusBalance: 40,
      escrowBalance: 0,
      pendingEscrow: 0,
      totalWithdrawable: 100,
    });
    // Первая записалась, вторая — дубль.
    mockLedger.debit
      .mockResolvedValueOnce({
        applied: ['withdrawal_debit:wr-1:1:AVAILABLE'],
        skipped: [],
      })
      .mockResolvedValueOnce({
        applied: [],
        skipped: ['withdrawal_debit:wr-1:1:REFERRAL'],
      });

    await expect(service.approveWithdrawal('wr-1')).rejects.toThrow(
      BadRequestException,
    );
    expect(mockPaymod.payout).not.toHaveBeenCalled();
  });
});

// ============================================================
// NH2 — Transaction не подтверждается до успешного холда
// ============================================================
describe('NH2: ретрай холда доходит до холда', () => {
  const tx = {
    id: 'tx-1',
    orderId: 'order-1',
    amount: 1000,
    amountRaw: (1000n * 10n ** 18n).toString(),
    expectedAmountRaw: (1000n * 10n ** 18n).toString(),
    tokenDecimals: 18,
    depositAddress: '0xDeposit',
    chain: 'bsc',
    token: 'USDT',
    status: 'PENDING',
    payload: null,
    order: { id: 'order-1', status: 'PENDING', buyerId: 'buyer-1' },
  };

  const mockPrisma = {
    transaction: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const mockLedger = { credit: jest.fn().mockResolvedValue({ applied: [], skipped: [] }) };
  const mockPayments = { processSuccessfulPayment: jest.fn() };
  let handler: PaymodWebhookHandler;

  const deposit = () => ({
    event: 'deposit',
    client_ref: 'mp-txn-order-1',
    tx_hash: '0xhash1',
    amount_raw: (1000n * 10n ** 18n).toString(),
    chain: 'bsc',
    token: 'USDT',
    to: '0xDeposit',
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.transaction.update.mockResolvedValue({});
    handler = new PaymodWebhookHandler(
      mockPrisma as any,
      { getFloat: jest.fn().mockResolvedValue(1) } as any,
      mockLedger as any,
      { createNotification: jest.fn().mockResolvedValue({}) } as any,
      mockPayments as any,
    );
  });

  it('холд упал → Transaction НЕ переводится в CONFIRMED', async () => {
    mockPrisma.transaction.findUnique
      .mockResolvedValueOnce(null) // txHash lookup
      .mockResolvedValueOnce(tx); // clientRef lookup
    mockPayments.processSuccessfulPayment.mockRejectedValue(
      new Error('db down'),
    );

    await expect(handler.handleDeposit(deposit())).rejects.toThrow('db down');

    // Ключевое: запись CONFIRMED не произошла — иначе повторный webhook
    // отобьётся дедупом и холд не выполнится НИКОГДА.
    const confirmedWrites = mockPrisma.transaction.update.mock.calls.filter(
      (c) => c[0]?.data?.status === 'CONFIRMED',
    );
    expect(confirmedWrites).toHaveLength(0);
  });

  it('повторная доставка после упавшего холда ДОХОДИТ до processSuccessfulPayment', async () => {
    // Ретрай: Transaction всё ещё PENDING, txHash в колонке не записан.
    mockPrisma.transaction.findUnique
      .mockResolvedValueOnce(null) // txHash lookup — не найден
      .mockResolvedValueOnce(tx); // clientRef lookup — PENDING
    mockPayments.processSuccessfulPayment.mockResolvedValue({});

    await handler.handleDeposit(deposit());

    expect(mockPayments.processSuccessfulPayment).toHaveBeenCalledWith(
      'order-1',
    );
    // И только теперь фиксируется CONFIRMED.
    expect(mockPrisma.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'CONFIRMED', txHash: '0xhash1' }),
      }),
    );
  });

  it('порядок вызовов: холд СТРОГО до записи CONFIRMED', async () => {
    const order: string[] = [];
    mockPrisma.transaction.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(tx);
    mockPayments.processSuccessfulPayment.mockImplementation(() => {
      order.push('hold');
      return Promise.resolve({});
    });
    mockPrisma.transaction.update.mockImplementation(() => {
      order.push('confirm');
      return Promise.resolve({});
    });

    await handler.handleDeposit(deposit());

    expect(order).toEqual(['hold', 'confirm']);
  });

  it('успешный холд: CONFIRMED пишется один раз, хэш в append-only списке', async () => {
    mockPrisma.transaction.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(tx);
    mockPayments.processSuccessfulPayment.mockResolvedValue({});

    await handler.handleDeposit(deposit());

    expect(mockPrisma.transaction.update).toHaveBeenCalledTimes(1);
    const data = mockPrisma.transaction.update.mock.calls[0][0].data;
    expect(data.payload.deposit.hashes).toContain('0xhash1');
  });
});

// ============================================================
// NH3 — adminForceStatus не обходит матрицу
// ============================================================
describe('NH3: adminForceStatus не оставляет эскроу висеть', () => {
  let service: OrdersService;
  const mockPrisma = {
    order: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn(),
    },
    deal: {
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
    },
  };
  const mockEscrow = {
    releaseEscrow: jest.fn(),
    refundEscrow: jest.fn(),
  };
  const mockSettings = {
    getFloat: jest.fn().mockResolvedValue(10),
    getInt: jest.fn((_k: string, d: number) => Promise.resolve(d)),
  };

  const orderWith = (status: string, escrowStatus: string) => ({
    id: 'order-1',
    buyerId: 'buyer-1',
    sellerId: 'seller-1',
    status,
    escrowStatus,
    amount: 1000,
    product: {},
    buyer: {},
    seller: {},
    referralUser: null,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.order.update.mockResolvedValue({});
    mockPrisma.deal.findFirst.mockResolvedValue(null);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: PaymentsService, useValue: { createPaymentForOrder: jest.fn() } },
        { provide: EscrowService, useValue: mockEscrow },
        { provide: SettingsService, useValue: mockSettings },
        {
          provide: NotificationsService,
          useValue: {
            createNotification: jest.fn(),
            sendToUser: jest.fn().mockResolvedValue(null),
          },
        },
      ],
    }).compile();
    service = module.get(OrdersService);
  });

  it('CANCELLED на PAID+HELD → НЕ ставит CANCELLED, а возвращает деньги', async () => {
    mockPrisma.order.findUnique.mockResolvedValue(orderWith('PAID', 'HELD'));
    mockEscrow.refundEscrow.mockResolvedValue({
      refunded: true,
      toBuyer: 1000,
    });

    await service.adminForceStatus(
      'order-1',
      { status: OrderStatus.CANCELLED } as any,
      'отмена админом',
    );

    // Деньги пошли через refundEscrow — эскроу закрыт, покупатель получил возврат.
    expect(mockEscrow.refundEscrow).toHaveBeenCalledWith(
      'order-1',
      'admin_refund',
      100,
    );
    // Прямой записи CANCELLED быть НЕ должно: она оставляла эскроу HELD.
    const cancelledWrite = mockPrisma.order.update.mock.calls.find(
      (c) => c[0]?.data?.status === 'CANCELLED',
    );
    expect(cancelledWrite).toBeUndefined();
  });

  it('CANCELLED на SHIPPED+HELD → тоже возврат, а не ярлык', async () => {
    mockPrisma.order.findUnique.mockResolvedValue(orderWith('SHIPPED', 'HELD'));
    mockEscrow.refundEscrow.mockResolvedValue({ refunded: true });

    await service.adminForceStatus(
      'order-1',
      { status: OrderStatus.CANCELLED } as any,
      'отмена',
    );

    expect(mockEscrow.refundEscrow).toHaveBeenCalled();
    const cancelledWrite = mockPrisma.order.update.mock.calls.find(
      (c) => c[0]?.data?.status === 'CANCELLED',
    );
    expect(cancelledWrite).toBeUndefined();
  });

  it('CANCELLED на PENDING+NONE → безопасно, эскроу не трогаем', async () => {
    mockPrisma.order.findUnique.mockResolvedValue(orderWith('PENDING', 'NONE'));

    await service.adminForceStatus(
      'order-1',
      { status: OrderStatus.CANCELLED } as any,
      'отмена неоплаченного',
    );

    expect(mockEscrow.refundEscrow).not.toHaveBeenCalled();
    expect(mockPrisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'CANCELLED' }),
      }),
    );
  });

  it('SHIPPED из PAID+HELD разрешён', async () => {
    mockPrisma.order.findUnique.mockResolvedValue(orderWith('PAID', 'HELD'));

    await service.adminForceStatus(
      'order-1',
      { status: OrderStatus.SHIPPED } as any,
      'продавец отправил',
    );

    expect(mockPrisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SHIPPED' }),
      }),
    );
  });

  it('SHIPPED из PENDING+NONE запрещён (нет эскроу-контура)', async () => {
    mockPrisma.order.findUnique.mockResolvedValue(orderWith('PENDING', 'NONE'));

    await expect(
      service.adminForceStatus(
        'order-1',
        { status: OrderStatus.SHIPPED } as any,
        'хочу так',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('PENDING поверх PAID+HELD запрещён (эскроу остался бы висеть)', async () => {
    mockPrisma.order.findUnique.mockResolvedValue(orderWith('PAID', 'HELD'));

    await expect(
      service.adminForceStatus(
        'order-1',
        { status: OrderStatus.PENDING } as any,
        'откат',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('REFUNDED по-прежнему идёт через refundEscrow (регресс D5)', async () => {
    mockPrisma.order.findUnique.mockResolvedValue(orderWith('PAID', 'HELD'));
    mockEscrow.refundEscrow.mockResolvedValue({ refunded: true });

    await service.adminForceStatus(
      'order-1',
      { status: OrderStatus.REFUNDED } as any,
      'возврат',
    );

    expect(mockEscrow.refundEscrow).toHaveBeenCalledWith(
      'order-1',
      'admin_refund',
      100,
    );
  });
});

// ============================================================
// NH4 — единая нумерация попыток reversal
// ============================================================
describe('NH4: reconcile берёт номер попытки из проводок списания', () => {
  let service: PaymentsService;
  const mockPrisma = {
    withdrawalRequest: {
      findMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    ledgerEntry: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const mockLedger = {
    credit: jest.fn().mockResolvedValue({ applied: [], skipped: [] }),
    debit: jest.fn(),
  };
  const paymodSvc = { getTxStatus: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((cb: any) => cb(mockPrisma));
    mockPrisma.withdrawalRequest.update.mockResolvedValue({});
    paymodSvc.getTxStatus.mockResolvedValue({ status: 'failed' });
    mockLedger.credit.mockResolvedValue({ applied: [], skipped: [] });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SettingsService, useValue: { get: jest.fn(), getFloat: jest.fn() } },
        { provide: NowPaymentsProvider, useValue: {} },
        { provide: PaymodProvider, useValue: {} },
        { provide: PaymodService, useValue: paymodSvc },
        { provide: LedgerService, useValue: mockLedger },
        { provide: NotificationsService, useValue: { createNotification: jest.fn() } },
        { provide: EscrowService, useValue: { holdForOrder: jest.fn() } },
      ],
    }).compile();
    service = module.get(PaymentsService);
  });

  it('номер попытки парсится из refKey дебета, а не из payoutAttempts', async () => {
    mockPrisma.withdrawalRequest.findMany.mockResolvedValue([
      {
        id: 'wr-9',
        userId: 'user-9',
        amount: 50,
        status: 'approved',
        payoutStatus: 'SUBMITTED',
        payoutTxHash: '0xtx9',
        // payoutAttempts намеренно РАСХОДИТСЯ с журналом: журнал — истина.
        payoutAttempts: 1,
      },
    ]);
    // В журнале дебет с attempt=3 (третья попытка), а payoutAttempts=1.
    mockPrisma.ledgerEntry.findMany.mockResolvedValue([
      {
        account: 'AVAILABLE',
        amount: -50,
        refKey: 'withdrawal_debit:wr-9:3:AVAILABLE',
      },
    ]);
    mockPrisma.withdrawalRequest.findUniqueOrThrow.mockResolvedValue({
      id: 'wr-9',
      status: 'approved',
      payoutAttempts: 1,
    });

    await service.reconcilePayouts();

    // Reversal пишется под ТЕМ ЖЕ номером, что и списание (3), иначе
    // namespace разъезжается и компенсация может быть съедена skipDuplicates.
    expect(mockLedger.credit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        refKey: 'withdrawal_reversal:wr-9:3:AVAILABLE',
        amount: 50,
        type: 'withdrawal_reversal',
      }),
    );
  });

  it('легаси-формат refKey без номера → fallback на payoutAttempts', async () => {
    mockPrisma.withdrawalRequest.findMany.mockResolvedValue([
      {
        id: 'wr-10',
        userId: 'user-10',
        amount: 25,
        status: 'approved',
        payoutStatus: 'SUBMITTED',
        payoutTxHash: '0xtx10',
        payoutAttempts: 2,
      },
    ]);
    mockPrisma.ledgerEntry.findMany.mockResolvedValue([
      { account: 'AVAILABLE', amount: -25, refKey: 'withdrawal_debit:wr-10:AVAILABLE' },
    ]);
    mockPrisma.withdrawalRequest.findUniqueOrThrow.mockResolvedValue({
      id: 'wr-10',
      status: 'approved',
      payoutAttempts: 2,
    });

    await service.reconcilePayouts();

    expect(mockLedger.credit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        refKey: 'withdrawal_reversal:wr-10:2:AVAILABLE',
      }),
    );
  });
});

// ============================================================
// NH4b — settleFailedPayout НЕ суммирует дебеты всех попыток
// ============================================================
describe('NH4b: завышенный возврат при нескольких попытках вывода', () => {
  let service: PaymentsService;

  const mockPrisma = {
    withdrawalRequest: {
      findMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    ledgerEntry: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const mockLedger = {
    credit: jest.fn().mockResolvedValue({ applied: [], skipped: [] }),
    debit: jest.fn(),
  };
  const paymodSvc = { getTxStatus: jest.fn() };

  /**
   * Роутинг по аргументу запроса: дебеты и reversal'ы — разные выборки.
   * Это ключевое отличие от старого теста, который отдавал одну строку и
   * поэтому не воспроизводил баг.
   */
  const routeLedger = (debits: any[], reversals: any[] = []) => {
    mockPrisma.ledgerEntry.findMany.mockImplementation((args: any) => {
      const prefix = args?.where?.refKey?.startsWith ?? '';
      if (prefix.startsWith('withdrawal_reversal:')) return Promise.resolve(reversals);
      if (prefix.startsWith('withdrawal_debit:')) return Promise.resolve(debits);
      return Promise.resolve([]);
    });
  };

  const submittedRequest = (over: Record<string, any> = {}) => ({
    id: 'wr-1',
    userId: 'user-1',
    amount: 100,
    status: 'approved',
    payoutStatus: 'SUBMITTED',
    payoutTxHash: '0xtx1',
    payoutAttempts: 2,
    ...over,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((cb: any) => cb(mockPrisma));
    mockPrisma.withdrawalRequest.update.mockResolvedValue({});
    paymodSvc.getTxStatus.mockResolvedValue({ status: 'failed' });
    mockLedger.credit.mockResolvedValue({ applied: [], skipped: [] });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SettingsService, useValue: { get: jest.fn(), getFloat: jest.fn() } },
        { provide: NowPaymentsProvider, useValue: {} },
        { provide: PaymodProvider, useValue: {} },
        { provide: PaymodService, useValue: paymodSvc },
        { provide: LedgerService, useValue: mockLedger },
        { provide: NotificationsService, useValue: { createNotification: jest.fn() } },
        { provide: EscrowService, useValue: { holdForOrder: jest.fn() } },
      ],
    }).compile();
    service = module.get(PaymentsService);
  });

  it('ДВЕ попытки: попытка 1 откачена, попытка 2 упала → возврат ровно 100, не 200', async () => {
    // Сценарий дыры NH4b: 100 → debit(1) → reversal(1) → debit(2) → failed.
    // Баланс пользователя после reversal(1) снова 100; debit(2) списал их.
    // Значит вернуть надо ровно 100 (остаток попытки 2).
    mockPrisma.withdrawalRequest.findMany.mockResolvedValue([submittedRequest()]);
    routeLedger(
      [
        { account: 'AVAILABLE', amount: -100, refKey: 'withdrawal_debit:wr-1:1:AVAILABLE' },
        { account: 'AVAILABLE', amount: -100, refKey: 'withdrawal_debit:wr-1:2:AVAILABLE' },
      ],
      [{ refKey: 'withdrawal_reversal:wr-1:1:AVAILABLE' }],
    );
    mockPrisma.withdrawalRequest.findUniqueOrThrow.mockResolvedValue({
      id: 'wr-1',
      status: 'approved',
      payoutAttempts: 2,
    });

    await service.reconcilePayouts();

    expect(mockLedger.credit).toHaveBeenCalledTimes(1);
    expect(mockLedger.credit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        refKey: 'withdrawal_reversal:wr-1:2:AVAILABLE',
        amount: 100,
        type: 'withdrawal_reversal',
      }),
    );
  });

  it('ТРИ попытки, две откачены → возврат только остатка последней (100)', async () => {
    mockPrisma.withdrawalRequest.findMany.mockResolvedValue([
      submittedRequest({ id: 'wr-2', payoutTxHash: '0xtx2', payoutAttempts: 3 }),
    ]);
    routeLedger(
      [
        { account: 'AVAILABLE', amount: -100, refKey: 'withdrawal_debit:wr-2:1:AVAILABLE' },
        { account: 'AVAILABLE', amount: -100, refKey: 'withdrawal_debit:wr-2:2:AVAILABLE' },
        { account: 'AVAILABLE', amount: -100, refKey: 'withdrawal_debit:wr-2:3:AVAILABLE' },
      ],
      [
        { refKey: 'withdrawal_reversal:wr-2:1:AVAILABLE' },
        { refKey: 'withdrawal_reversal:wr-2:2:AVAILABLE' },
      ],
    );
    mockPrisma.withdrawalRequest.findUniqueOrThrow.mockResolvedValue({
      id: 'wr-2',
      status: 'approved',
      payoutAttempts: 3,
    });

    await service.reconcilePayouts();

    expect(mockLedger.credit).toHaveBeenCalledTimes(1);
    expect(mockLedger.credit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        refKey: 'withdrawal_reversal:wr-2:3:AVAILABLE',
        amount: 100,
      }),
    );
  });

  it('ВСЕ попытки уже откачены → возврат 0, credit не вызывается', async () => {
    mockPrisma.withdrawalRequest.findMany.mockResolvedValue([
      submittedRequest({ id: 'wr-3', payoutTxHash: '0xtx3' }),
    ]);
    routeLedger(
      [
        { account: 'AVAILABLE', amount: -100, refKey: 'withdrawal_debit:wr-3:1:AVAILABLE' },
        { account: 'AVAILABLE', amount: -100, refKey: 'withdrawal_debit:wr-3:2:AVAILABLE' },
      ],
      [
        { refKey: 'withdrawal_reversal:wr-3:1:AVAILABLE' },
        { refKey: 'withdrawal_reversal:wr-3:2:AVAILABLE' },
      ],
    );
    mockPrisma.withdrawalRequest.findUniqueOrThrow.mockResolvedValue({
      id: 'wr-3',
      status: 'approved',
      payoutAttempts: 2,
    });

    await service.reconcilePayouts();

    expect(mockLedger.credit).not.toHaveBeenCalled();
    // Заявка всё равно переводится в pending/FAILED.
    expect(mockPrisma.withdrawalRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'pending', payoutStatus: 'FAILED' }),
      }),
    );
  });

  it('НЕТ дебетов → возврат 0, без падения', async () => {
    mockPrisma.withdrawalRequest.findMany.mockResolvedValue([
      submittedRequest({ id: 'wr-4', payoutTxHash: '0xtx4' }),
    ]);
    routeLedger([], []);
    mockPrisma.withdrawalRequest.findUniqueOrThrow.mockResolvedValue({
      id: 'wr-4',
      status: 'approved',
      payoutAttempts: 1,
    });

    await expect(service.reconcilePayouts()).resolves.toEqual({
      checked: 1,
      confirmed: 0,
      failed: 1,
    });
    expect(mockLedger.credit).not.toHaveBeenCalled();
  });

  it('ОДНА попытка (регресс NH4-теста) → возврат 50 как раньше', async () => {
    mockPrisma.withdrawalRequest.findMany.mockResolvedValue([
      submittedRequest({ id: 'wr-5', amount: 50, payoutTxHash: '0xtx5', payoutAttempts: 1 }),
    ]);
    routeLedger([
      { account: 'AVAILABLE', amount: -50, refKey: 'withdrawal_debit:wr-5:1:AVAILABLE' },
    ]);
    mockPrisma.withdrawalRequest.findUniqueOrThrow.mockResolvedValue({
      id: 'wr-5',
      status: 'approved',
      payoutAttempts: 1,
    });

    await service.reconcilePayouts();

    expect(mockLedger.credit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        refKey: 'withdrawal_reversal:wr-5:1:AVAILABLE',
        amount: 50,
      }),
    );
  });

  it('частичный reversal: AVAILABLE откачен, REFERRAL — нет → возвращается только REFERRAL', async () => {
    mockPrisma.withdrawalRequest.findMany.mockResolvedValue([
      submittedRequest({ id: 'wr-6', payoutTxHash: '0xtx6' }),
    ]);
    routeLedger(
      [
        { account: 'AVAILABLE', amount: -60, refKey: 'withdrawal_debit:wr-6:1:AVAILABLE' },
        { account: 'REFERRAL', amount: -40, refKey: 'withdrawal_debit:wr-6:1:REFERRAL' },
      ],
      [{ refKey: 'withdrawal_reversal:wr-6:1:AVAILABLE' }],
    );
    mockPrisma.withdrawalRequest.findUniqueOrThrow.mockResolvedValue({
      id: 'wr-6',
      status: 'approved',
      payoutAttempts: 1,
    });

    await service.reconcilePayouts();

    expect(mockLedger.credit).toHaveBeenCalledTimes(1);
    expect(mockLedger.credit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        refKey: 'withdrawal_reversal:wr-6:1:REFERRAL',
        amount: 40,
      }),
    );
  });
});

// ============================================================
// D3 (остаток) — lost-response double payout
// ============================================================
describe('D3: потерянный ответ payout не приводит к двойной выплате', () => {
  let service: UsersService;

  const mockPrisma = {
    withdrawalRequest: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    user: { findUnique: jest.fn() },
    $transaction: jest.fn((cb: any) => cb(mockPrisma)),
  };
  const mockLedger = {
    getBalances: jest.fn(),
    debit: jest
      .fn()
      .mockImplementation((_tx: any, p: any) =>
        Promise.resolve({ applied: [p.refKey], skipped: [] }),
      ),
    credit: jest.fn().mockResolvedValue({ applied: [], skipped: [] }),
  };
  const mockPaymod = { payout: jest.fn(), getPayout: jest.fn() };

  const request = {
    id: 'wr-1',
    userId: 'user-1',
    amount: 100,
    status: 'pending',
    toAddress: '0x' + 'a'.repeat(40),
    payoutAttempts: 0,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((cb: any) => cb(mockPrisma));
    mockPrisma.withdrawalRequest.findUnique.mockResolvedValue(request);
    mockPrisma.withdrawalRequest.update.mockResolvedValue({});
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      walletAddress: null,
      bonusBalance: 0,
    });
    mockPrisma.withdrawalRequest.findUniqueOrThrow.mockResolvedValue({
      id: 'wr-1',
      status: 'pending',
      payoutStatus: 'FAILED',
    });
    mockLedger.getBalances.mockResolvedValue({
      availableBalance: 500,
      bonusBalance: 0,
      escrowBalance: 0,
      pendingEscrow: 0,
      totalWithdrawable: 500,
    });
    mockLedger.debit.mockImplementation((_tx: any, p: any) =>
      Promise.resolve({ applied: [p.refKey], skipped: [] }),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: NotificationsService, useValue: { createNotification: jest.fn() } },
        { provide: SettingsService, useValue: { getFloat: jest.fn() } },
        { provide: PaymodService, useValue: mockPaymod },
        { provide: LedgerService, useValue: mockLedger },
      ],
    }).compile();
    service = module.get(UsersService);
  });

  it('ответ потерян, но выплата ушла → НЕ откатываем, фиксируем SUBMITTED', async () => {
    mockPaymod.payout.mockRejectedValue(new Error('timeout'));
    // Read-only проверка: выплата с этим ключом есть и она submitted.
    mockPaymod.getPayout.mockResolvedValue({
      tx_hash: '0xonchain',
      status: 'submitted',
    });

    await service.approveWithdrawal('wr-1');

    // Ключевое: reversal НЕ сделан — деньги не вернулись на баланс.
    expect(mockLedger.credit).not.toHaveBeenCalled();
    // Заявка помечена как реально отправленная с известным хэшем.
    expect(mockPrisma.withdrawalRequest.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payoutTxHash: '0xonchain',
          payoutStatus: 'SUBMITTED',
        }),
      }),
    );
  });

  it('ответ потерян, выплаты НЕТ → безопасный откат', async () => {
    mockPaymod.payout.mockRejectedValue(new Error('timeout'));
    mockPaymod.getPayout.mockResolvedValue(null); // ключа нет

    await service.approveWithdrawal('wr-1');

    expect(mockLedger.credit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'withdrawal_reversal',
        refKey: 'withdrawal_reversal:wr-1:1:AVAILABLE',
      }),
    );
  });

  it('запись есть, но статус failed → откат разрешён', async () => {
    mockPaymod.payout.mockRejectedValue(new Error('timeout'));
    mockPaymod.getPayout.mockResolvedValue({
      tx_hash: null,
      status: 'failed',
    });

    await service.approveWithdrawal('wr-1');

    expect(mockLedger.credit).toHaveBeenCalled();
  });

  it('sidecar недоступен → слепого отката НЕТ (риск двойной выплаты)', async () => {
    mockPaymod.payout.mockRejectedValue(new Error('timeout'));
    mockPaymod.getPayout.mockRejectedValue(new Error('paymod error: 503'));

    await expect(service.approveWithdrawal('wr-1')).rejects.toThrow(
      BadRequestException,
    );

    expect(mockLedger.credit).not.toHaveBeenCalled();
  });

  it('используется READ-ONLY getPayout, а не повторный payout (иначе 2-й перевод)', async () => {
    mockPaymod.payout.mockRejectedValue(new Error('timeout'));
    mockPaymod.getPayout.mockResolvedValue(null);

    await service.approveWithdrawal('wr-1');

    expect(mockPaymod.getPayout).toHaveBeenCalledTimes(1);
    // payout вызван ровно один раз — исходная попытка. Повторный вызов
    // создал бы реальную вторую выплату.
    expect(mockPaymod.payout).toHaveBeenCalledTimes(1);
  });
});