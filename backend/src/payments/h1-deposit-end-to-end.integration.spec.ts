/**
 * H1 (integration, РЕАЛЬНАЯ БД + РЕАЛЬНЫЙ sidecar-код): депозит подтверждается
 * end-to-end.
 *
 * Баг: реальный депозит НИКОГДА не подтверждался.
 *   1) `paymod.watcher._handle_log` отдаёт `amount_atomic`, а
 *      `paymod-sidecar/app/background.py` читал `amount_raw` → всегда `""`
 *      → `parseRawAmount("")` → `unverifiable_amount_raw`, Transaction навсегда
 *      PENDING.
 *   2) даже с правильным именем: `amount_atomic` нормализован watcher'ом к
 *      6 decimals, а `Transaction.expectedAmountRaw` — в 18 (BSC/USDT) →
 *      UNDERPAID в 10^12 раз.
 *
 * Тест намеренно НЕ собирает payload руками «с правильным полем»: он вызывает
 * настоящую `background._on_deposit` (через tests/build_watcher_webhook.py) с
 * deposit-словарём ровно того вида, который кладёт watcher, и отправляет то,
 * что функция реально вернула, с валидным HMAC.
 *
 * Контроль (без фикса): тело, которое собирал СТАРЫЙ background.py, с тем же
 * deposit'ом → `unverifiable_amount_raw`, заказ PENDING, эскроу NONE.
 */
import { spawnSync } from 'child_process';
import { createHmac } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  EscrowStatus,
  LedgerAccount,
  OrderStatus,
  TransactionStatus,
} from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { cleanupTestData } from '../common/prisma/test-db-cleanup';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { EscrowService } from './escrow.service';
import { LedgerService } from './ledger.service';
import { PaymentsService } from './payments.service';
import { PaymodService } from './paymod.service';
import { PaymodWebhookHandler } from './paymod-webhook.handler';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SIDECAR = path.join(REPO_ROOT, 'paymod-sidecar');
const PYTHON = path.join(SIDECAR, 'venv/bin/python');
const BUILDER = path.join(SIDECAR, 'tests/build_watcher_webhook.py');
const BACKEND_ENV = path.join(REPO_ROOT, 'backend/.env');

const SUFFIX = `h1-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

interface LiveEnvelope {
  payload: Record<string, unknown>;
  body: string;
  timestamp: string;
  signature: string;
}

/** Подгружает backend/.env, чтобы PAYMOD_SHARED_SECRET был тем же, что в бою. */
function loadBackendEnv(): void {
  if (!fs.existsSync(BACKEND_ENV)) return;
  for (const raw of fs.readFileSync(BACKEND_ENV, 'utf-8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const idx = line.indexOf('=');
    const key = line.slice(0, idx).trim();
    const value = line
      .slice(idx + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/**
 * Прогоняет РЕАЛЬНЫЙ `app.background._on_deposit` и возвращает то, что он
 * отправил бы в webhook: payload + сырое тело + подпись.
 */
function buildLiveWebhook(deposit: Record<string, unknown>): LiveEnvelope {
  const res = spawnSync(PYTHON, [BUILDER, JSON.stringify(deposit)], {
    cwd: SIDECAR,
    encoding: 'utf-8',
  });
  if (res.status !== 0) {
    throw new Error(
      `build_watcher_webhook.py failed (status=${res.status}): ${res.stderr || res.stdout}`,
    );
  }
  const parsed = JSON.parse(res.stdout.trim()) as LiveEnvelope & {
    error?: string;
  };
  if (parsed.error) throw new Error(`builder error: ${parsed.error}`);
  return parsed;
}

/**
 * Явное приведение скаляра из нетипизированного JSON к строке.
 * `String(unknown)` на объекте даёт '[object Object]' — поэтому сужаем
 * осознанно: только строки/числа, остальное → ''.
 */
function scalarString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  return '';
}

/** Тело, которое собирал background.py ДО фикса (для контрольного прогона). */
function legacyBody(deposit: Record<string, unknown>): string {
  const chainId = deposit.chain_id ?? deposit.chain ?? '';
  return JSON.stringify({
    event: 'deposit',
    client_ref: deposit.client_ref ?? deposit.wallet_id ?? '',
    chain: scalarString(chainId).toLowerCase(),
    token: deposit.token ?? deposit.symbol ?? '',
    token_address: deposit.token_address ?? '',
    tx_hash: deposit.tx_hash ?? '',
    from: deposit.from ?? '',
    to: deposit.to ?? '',
    amount: deposit.amount ?? '',
    amount_raw: scalarString(deposit.amount_raw),
    block_number: deposit.block_number ?? null,
  });
}

describe('H1 (integration): реальный депозит paymod подтверждается end-to-end', () => {
  const prisma = new PrismaService();
  const notify = {
    createNotification: jest.fn().mockResolvedValue(null),
    sendToUser: jest.fn().mockResolvedValue(null),
  } as unknown as NotificationsService;

  const ledger = new LedgerService(prisma, notify);
  const settings = new SettingsService(prisma);
  const escrow = new EscrowService(prisma, ledger, settings, notify);
  const handler = new PaymodWebhookHandler(
    prisma,
    settings,
    ledger,
    notify,
    new PaymentsService(
      prisma,
      settings,
      {} as never,
      {} as never,
      {} as never,
      ledger,
      notify,
      escrow,
    ),
  );

  const userIds: string[] = [];
  const orderIds: string[] = [];
  let buyerId = '';
  let sellerId = '';
  let paymodService: PaymodService;

  const mkUser = async (name: string, role: 'BUYER' | 'SELLER') => {
    const user = await prisma.user.create({
      data: {
        phone: `${SUFFIX}-${name}`,
        name: `H1 ${name}`,
        role,
        referralCode: `${SUFFIX}-${name}`,
      },
    });
    userIds.push(user.id);
    return user;
  };

  /** Заказ + PENDING-транзакция ровно так, как их создаёт createPaymentForOrder. */
  const mkOrder = async (amount: number, depositAddress: string) => {
    const order = await prisma.order.create({
      data: {
        buyerId,
        sellerId,
        amount,
        status: OrderStatus.PENDING,
        platformFee: 0,
        referralBonus: 0,
        priceSource: 'PRODUCT',
      },
    });
    orderIds.push(order.id);

    const amountRaw = (
      BigInt(Math.round(amount * 1_000_000)) *
      10n ** 12n
    ).toString();
    const clientRef = `mp-txn-${order.id}`;
    const tx = await prisma.transaction.create({
      data: {
        orderId: order.id,
        type: 'payment',
        amount,
        status: TransactionStatus.PENDING,
        provider: 'PAYMOD',
        clientRef,
        depositAddress,
        chain: 'bsc',
        token: 'USDT',
        amountRaw,
        expectedAmountRaw: amountRaw,
        tokenDecimals: 18,
        payload: {},
      },
    });
    return { order, tx, clientRef };
  };

  /** deposit-словарь РОВНО в форме `paymod.watcher._handle_log`. */
  const watcherDeposit = (
    clientRef: string,
    amountAtomic: number,
    txHash: string,
  ) => ({
    wallet_id: 1,
    client_ref: clientRef,
    network: 'BSC',
    symbol: 'USDT',
    amount: amountAtomic / 1_000_000,
    amount_atomic: amountAtomic,
    tx_hash: txHash,
    is_new: true,
  });

  beforeAll(async () => {
    loadBackendEnv();
    await prisma.$connect();
    await settings.set('escrow_ship_deadline_days', '5');
    await settings.set('escrow_autocomplete_days', '7');
    buyerId = (await mkUser('buyer', 'BUYER')).id;
    sellerId = (await mkUser('seller', 'SELLER')).id;
    paymodService = new PaymodService({
      getOrThrow: () => process.env.PAYMOD_SHARED_SECRET as string,
      get: () => undefined,
    } as never);
  });

  afterAll(async () => {
    await cleanupTestData(
      prisma,
      { userIds, orderIds },
      { prefixes: ['h1-'], refKeyContains: SUFFIX },
    );
    await prisma.$disconnect();
  });

  // ── 0. sidecar действительно отдаёт контракт бэкенда ─────────────────────

  it('background._on_deposit отдаёт amount_raw в 18 decimals и непустой chain', () => {
    const deposit = watcherDeposit(
      'mp-txn-smoke',
      1_000_000,
      '0x' + 'aa'.repeat(32),
    );
    const live = buildLiveWebhook(deposit);

    expect(live.payload.amount_raw).toBe('1000000000000000000');
    expect(live.payload.chain).toBe('bsc');
    expect(live.payload.token).toBe('USDT');
    expect(live.payload.token_address).toBe(
      '0x55d398326f99059ff775485246999027b3197955',
    );
    expect(live.signature.length).toBeGreaterThan(0);
    // body — ровно те байты, что уйдут по HTTP (json.dumps payload'а)
    expect(JSON.parse(live.body)).toEqual(live.payload);
  });

  // ── 1. КОНТРОЛЬ: старое тело → unverifiable_amount_raw, заказ PENDING ────

  it('ДО фикса тот же deposit → unverifiable_amount_raw, заказ PENDING, эскроу NONE', async () => {
    const { order, tx, clientRef } = await mkOrder(1, '0xDepositH1Legacy');
    const deposit = watcherDeposit(
      clientRef,
      1_000_000,
      '0x' + 'b1'.repeat(32),
    );
    const body = legacyBody(deposit);

    // HMAC считается ровно как в PaymodService.sign и проверяется его же кодом —
    // то есть контрольный прогон не «обходит» валидацию подписи.
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac(
      'sha256',
      process.env.PAYMOD_SHARED_SECRET as string,
    )
      .update(`${timestamp}.${body}`)
      .digest('base64');
    expect(
      paymodService.verifyWebhookSignature(timestamp, body, signature),
    ).toBe(true);

    expect((JSON.parse(body) as { amount_raw: string }).amount_raw).toBe('');

    await handler.handleDeposit(JSON.parse(body));

    const after = await prisma.transaction.findUniqueOrThrow({
      where: { id: tx.id },
    });
    const afterOrder = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });

    expect(after.status).toBe(TransactionStatus.PENDING);
    expect(after.mismatchReason).toBe('unverifiable_amount_raw');
    expect(afterOrder.status).toBe(OrderStatus.PENDING);
    expect(afterOrder.escrowStatus).toBe(EscrowStatus.NONE);
  });

  // ── 2. ГЛАВНОЕ: живой payload → CONFIRMED / PAID / HELD ──────────────────

  it('ЖИВОЙ payload из background.py: 1 USDT → CONFIRMED, PAID, HELD, суммы верные', async () => {
    const { order, tx, clientRef } = await mkOrder(1, '0xDepositH1Live');
    const txHash = '0x' + 'c1'.repeat(32);
    const deposit = watcherDeposit(clientRef, 1_000_000, txHash);

    const live = buildLiveWebhook(deposit);
    expect(live.payload.amount_raw).toBe('1000000000000000000');

    // HMAC-валидация ровно как в контроллере
    expect(
      paymodService.verifyWebhookSignature(
        live.timestamp,
        live.body,
        live.signature,
      ),
    ).toBe(true);

    await handler.handleDeposit(JSON.parse(live.body));

    const after = await prisma.transaction.findUniqueOrThrow({
      where: { id: tx.id },
    });
    const afterOrder = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });

    // Transaction
    expect(after.status).toBe(TransactionStatus.CONFIRMED);
    expect(after.mismatchReason).toBeNull();
    expect(after.receivedAmountRaw).toBe('1000000000000000000');
    expect(after.expectedAmountRaw).toBe('1000000000000000000');
    expect(after.confirmedAt).not.toBeNull();

    // Order
    expect(afterOrder.status).toBe(OrderStatus.PAID);
    expect(afterOrder.paidAt).not.toBeNull();

    // Escrow
    expect(afterOrder.escrowStatus).toBe(EscrowStatus.HELD);
    expect(afterOrder.escrowAmount).toBe(1);
    expect(afterOrder.autoCompleteAt).not.toBeNull();

    // Ledger: заморозка ровно на 1 USDT, одна проводка
    const holds = await prisma.ledgerEntry.findMany({
      where: { orderId: order.id, type: 'escrow_hold' },
    });
    expect(holds).toHaveLength(1);
    expect(holds[0].account).toBe(LedgerAccount.ESCROW);
    expect(holds[0].amount).toBe(1);
    expect(holds[0].userId).toBe(buyerId);
  });

  // ── 3. Сумма: 12.34 USDT не уезжает в UNDERPAID ──────────────────────────

  it('12.34 USDT (12_340_000 atomic) → CONFIRMED, эскроу 12.34', async () => {
    const { order, tx, clientRef } = await mkOrder(
      12.34,
      '0xDepositH1Precision',
    );
    const deposit = watcherDeposit(
      clientRef,
      12_340_000,
      '0x' + 'c2'.repeat(32),
    );
    const live = buildLiveWebhook(deposit);

    expect(live.payload.amount_raw).toBe('12340000000000000000');

    await handler.handleDeposit(JSON.parse(live.body));

    const after = await prisma.transaction.findUniqueOrThrow({
      where: { id: tx.id },
    });
    const afterOrder = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(after.status).toBe(TransactionStatus.CONFIRMED);
    expect(afterOrder.status).toBe(OrderStatus.PAID);
    expect(afterOrder.escrowStatus).toBe(EscrowStatus.HELD);
    expect(afterOrder.escrowAmount).toBe(12.34);
  });

  // ── 4. Недоплата всё ещё ловится (фикс не сломал контроль сумм) ──────────

  it('0.5 USDT на заказ 1 USDT → UNDERPAID, заказ НЕ оплачен', async () => {
    const { order, tx, clientRef } = await mkOrder(1, '0xDepositH1Under');
    const deposit = watcherDeposit(clientRef, 500_000, '0x' + 'c3'.repeat(32));
    const live = buildLiveWebhook(deposit);

    expect(live.payload.amount_raw).toBe('500000000000000000');

    await handler.handleDeposit(JSON.parse(live.body));

    const after = await prisma.transaction.findUniqueOrThrow({
      where: { id: tx.id },
    });
    const afterOrder = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(after.status).toBe(TransactionStatus.UNDERPAID);
    expect(after.mismatchReason).toBe('underpaid');
    expect(afterOrder.status).toBe(OrderStatus.PENDING);
    expect(afterOrder.escrowStatus).toBe(EscrowStatus.NONE);
  });

  // ── 5. Сверка адреса получателя теперь РЕАЛЬНО работает ─────────────────

  it('депозит на чужой адрес → FAILED address_mismatch (сверка не мертва)', async () => {
    const { tx, clientRef } = await mkOrder(1, '0xCorrectDepositAddress');
    // `to` watcher не пробрасывает (см. report.md §6) — подкладываем адрес так,
    // как это сделал бы проброшенный watcher, и проверяем, что сверка жива.
    const deposit = {
      ...watcherDeposit(clientRef, 1_000_000, '0x' + 'c4'.repeat(32)),
      to: '0xSomeoneElsesAddress',
    };
    const live = buildLiveWebhook(deposit);
    expect(live.payload.to).toBe('0xSomeoneElsesAddress');

    await handler.handleDeposit(JSON.parse(live.body));

    const after = await prisma.transaction.findUniqueOrThrow({
      where: { id: tx.id },
    });
    expect(after.status).toBe(TransactionStatus.FAILED);
    expect(after.mismatchReason).toBe('address_mismatch');
  });

  // ── 6. Идемпотентность: повтор той же доставки — no-op ──────────────────

  it('повторный webhook того же tx_hash не задваивает холд', async () => {
    const { order, clientRef } = await mkOrder(1, '0xDepositH1Idem');
    const deposit = watcherDeposit(
      clientRef,
      1_000_000,
      '0x' + 'c5'.repeat(32),
    );
    const live = buildLiveWebhook(deposit);

    await handler.handleDeposit(JSON.parse(live.body));
    await handler.handleDeposit(JSON.parse(live.body));

    const holds = await prisma.ledgerEntry.findMany({
      where: { orderId: order.id, type: 'escrow_hold' },
    });
    expect(holds).toHaveLength(1);
    const afterOrder = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(afterOrder.escrowStatus).toBe(EscrowStatus.HELD);
    expect(afterOrder.escrowAmount).toBe(1);
  });
});
