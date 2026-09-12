/**
 * Тесты сверки депозита (§6 ТЗ, этап 5).
 * Мокаем Prisma — проверяем ветки: точная оплата, переплата, недоплата
 * в допуске и сверх, mismatch адреса/сети, сиротский депозит.
 */
import { PaymodWebhookHandler } from './paymod-webhook.handler';
import { PrismaService } from '../common/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LedgerService } from './ledger.service';
import { PaymentsService } from './payments.service';

const WEI = 10n ** 18n;

describe('PaymodWebhookHandler (§6)', () => {
  let handler: PaymodWebhookHandler;
  let warnSpy!: jest.SpyInstance;

  const tx = {
    id: 'tx-1',
    orderId: 'order-1',
    amount: 1000,
    amountRaw: (1000n * WEI).toString(),
    expectedAmountRaw: (1000n * WEI).toString(),
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
  const mockSettings = {
    getFloat: jest.fn().mockResolvedValue(1),
  };
  const mockNotifications = {
    createNotification: jest.fn().mockResolvedValue({}),
  };
  const mockLedger = {
    credit: jest.fn().mockResolvedValue({ applied: [], skipped: [] }),
  };
  const mockPayments = {
    processSuccessfulPayment: jest.fn().mockResolvedValue({}),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSettings.getFloat.mockResolvedValue(1);
    mockPrisma.transaction.update.mockResolvedValue({});
    mockPrisma.transaction.findUnique
      .mockResolvedValueOnce(null) // txHash lookup
      .mockResolvedValueOnce(tx); // clientRef lookup
    handler = new PaymodWebhookHandler(
      mockPrisma as unknown as PrismaService,
      mockSettings as unknown as SettingsService,
      mockLedger as unknown as LedgerService,
      mockNotifications as unknown as NotificationsService,
      mockPayments as unknown as PaymentsService,
    );
    // J3: пустой `to` — не reject, но громкий warn. Проверяем, что он есть.
    warnSpy = jest
      .spyOn(
        (handler as unknown as { logger: { warn: (m: string) => void } })
          .logger,
        'warn',
      )
      .mockImplementation(() => undefined);
  });

  const deposit = (over: Record<string, unknown> = {}) => ({
    event: 'deposit',
    client_ref: 'mp-txn-order-1',
    tx_hash: '0xhash1',
    amount_raw: (1000n * WEI).toString(),
    chain: 'bsc',
    token: 'USDT',
    to: '0xDeposit',
    ...over,
  });

  it('точная оплата → CONFIRMED + processSuccessfulPayment (эскроу-холд)', async () => {
    await handler.handleDeposit(deposit());
    expect(mockPrisma.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'CONFIRMED' }),
      }),
    );
    expect(mockPayments.processSuccessfulPayment).toHaveBeenCalledWith(
      'order-1',
    );
  });

  it('недоплата 0.01 на заказ 1000 → UNDERPAID, заказ НЕ обрабатывается', async () => {
    await handler.handleDeposit(
      deposit({ amount_raw: (WEI / 100n).toString() }),
    );
    expect(mockPrisma.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'UNDERPAID',
          mismatchReason: 'underpaid',
        }),
      }),
    );
    expect(mockPayments.processSuccessfulPayment).not.toHaveBeenCalled();
  });

  it('переплата 1100 → OVERPAID + 100 на баланс покупателя', async () => {
    await handler.handleDeposit(
      deposit({ amount_raw: (1100n * WEI).toString() }),
    );
    expect(mockPrisma.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'OVERPAID' }),
      }),
    );
    expect(mockLedger.credit).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        amount: 100,
        type: 'deposit_overpay',
        refKey: 'deposit_overpay:tx:0xhash1',
      }),
    );
    expect(mockPayments.processSuccessfulPayment).toHaveBeenCalledWith(
      'order-1',
    );
  });

  it('недоплата в пределах допуска (0.5%) → CONFIRMED', async () => {
    await handler.handleDeposit(
      deposit({ amount_raw: ((995n * WEI) / 1n).toString() }),
    );
    expect(mockPrisma.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'CONFIRMED' }),
      }),
    );
    expect(mockPayments.processSuccessfulPayment).toHaveBeenCalled();
  });

  it('chain mismatch → FAILED, заказ не обрабатывается', async () => {
    await handler.handleDeposit(deposit({ chain: 'eth' }));
    expect(mockPrisma.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          mismatchReason: 'chain_mismatch',
        }),
      }),
    );
    expect(mockPayments.processSuccessfulPayment).not.toHaveBeenCalled();
  });

  it('address mismatch → FAILED', async () => {
    await handler.handleDeposit(deposit({ to: '0xAttacker' }));
    expect(mockPrisma.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          mismatchReason: 'address_mismatch',
        }),
      }),
    );
    expect(mockPayments.processSuccessfulPayment).not.toHaveBeenCalled();
  });

  // ── J3: сверка адреса получателя ────────────────────────────────────────
  //
  // До J3 sidecar слал `to: ""` (вендоренный watcher поле не отдаёт), и
  // проверка выше короткозамыкалась на пустом `to` — то есть была МЕРТВА.
  // Теперь sidecar достаёт адрес сам, а handler:
  //   - при непустом `to` сверяет СТРОГО (несовпадение → reject);
  //   - при пустом `to` — warn, но НЕ reject (иначе потеряли бы реальные деньги).

  it('to совпадает с depositAddress (регистр не важен) → CONFIRMED', async () => {
    await handler.handleDeposit(deposit({ to: '0xDEPOSIT' }));
    expect(mockPayments.processSuccessfulPayment).toHaveBeenCalledWith(
      'order-1',
    );
    const failCall = mockPrisma.transaction.update.mock.calls.find(
      (c) => (c[0] as { data?: { status?: string } }).data?.status === 'FAILED',
    );
    expect(failCall).toBeUndefined();
  });

  it('пустой to → НЕ reject (обратная совместимость), заказ обрабатывается', async () => {
    await handler.handleDeposit(deposit({ to: '' }));
    expect(mockPayments.processSuccessfulPayment).toHaveBeenCalledWith(
      'order-1',
    );
    const failCall = mockPrisma.transaction.update.mock.calls.find(
      (c) => (c[0] as { data?: { status?: string } }).data?.status === 'FAILED',
    );
    expect(failCall).toBeUndefined();
    // Сверка пропущена — это обязано быть видно в логах.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('deposit address NOT verified'),
    );
  });

  it('to отсутствует в теле → НЕ reject, warn в логе', async () => {
    const body = deposit();
    delete (body as Record<string, unknown>).to;
    await handler.handleDeposit(body);
    expect(mockPayments.processSuccessfulPayment).toHaveBeenCalledWith(
      'order-1',
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('deposit address NOT verified'),
    );
  });

  it('token mismatch → FAILED (проверка токена жива)', async () => {
    await handler.handleDeposit(deposit({ token: 'USDC' }));
    expect(mockPrisma.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          mismatchReason: 'token_mismatch',
        }),
      }),
    );
    expect(mockPayments.processSuccessfulPayment).not.toHaveBeenCalled();
  });

  it('сиротский депозит (заказ CANCELLED) → на баланс покупателя + CONFIRMED', async () => {
    mockPrisma.transaction.findUnique
      .mockReset()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...tx,
        order: { id: 'order-1', status: 'CANCELLED', buyerId: 'buyer-1' },
      });
    await handler.handleDeposit(deposit());
    expect(mockLedger.credit).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        type: 'orphan_deposit',
        refKey: 'orphan_deposit:tx:0xhash1',
      }),
    );
    // Сиротский депозит НЕ запускает холд по отменённому заказу.
    expect(mockPayments.processSuccessfulPayment).not.toHaveBeenCalled();
  });

  it('повторный tx_hash — no-op (идемпотентность)', async () => {
    mockPrisma.transaction.findUnique
      .mockReset()
      .mockResolvedValueOnce({ id: 'tx-existing' }); // txHash уже есть
    await handler.handleDeposit(deposit());
    expect(mockPrisma.transaction.update).not.toHaveBeenCalled();
    expect(mockPayments.processSuccessfulPayment).not.toHaveBeenCalled();
  });
});
