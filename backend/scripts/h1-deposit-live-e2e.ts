/**
 * H1 — ЖИВОЕ доказательство end-to-end против ЗАПУЩЕННОГО бэкенда (:3000).
 *
 * Полный путь реального депозита, без единого «руками собранного» поля:
 *   1. в БД создаётся заказ + PENDING-транзакция (как createPaymentForOrder);
 *   2. payload собирает НАСТОЯЩАЯ `paymod-sidecar/app/background._on_deposit`,
 *      вызванная с deposit-словарём ровно того вида, что кладёт
 *      `paymod.watcher._handle_log`;
 *   3. сырое тело подписывается тем же HMAC-кодом, что и в бою
 *      (`app.auth.hmac_sign_headers`) и отправляется HTTP POST'ом на
 *      http://127.0.0.1:3000/payments/paymod/webhook;
 *   4. проверяем, что в БД Transaction=CONFIRMED, Order=PAID, escrow=HELD,
 *      суммы верные; затем убираем за собой.
 *
 * Запуск: npx ts-node --compiler-options '{"module":"commonjs"}' \
 *           scripts/h1-deposit-live-e2e.ts
 */
import { spawnSync } from 'child_process';
import * as path from 'path';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { cleanupTestData } from '../src/common/prisma/test-db-cleanup';

const REPO_ROOT = path.resolve(__dirname, '../..');
const SIDECAR = path.join(REPO_ROOT, 'paymod-sidecar');
const PYTHON = path.join(SIDECAR, 'venv/bin/python');
const BUILDER = path.join(SIDECAR, 'tests/build_watcher_webhook.py');
const WEBHOOK_URL =
  process.env.PAYMOD_WEBHOOK_URL ||
  'http://127.0.0.1:3000/payments/paymod/webhook';

const prisma = new PrismaService();
const SUFFIX = `h1live-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

let failures = 0;
function check(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name} ${extra}`);
  }
}

interface Envelope {
  payload: Record<string, unknown>;
  body: string;
  timestamp: string;
  signature: string;
}

/** Реальный `background._on_deposit` -> (payload, body, signature). */
function buildLiveWebhook(deposit: Record<string, unknown>): Envelope {
  const res = spawnSync(PYTHON, [BUILDER, JSON.stringify(deposit)], {
    cwd: SIDECAR,
    encoding: 'utf-8',
  });
  if (res.status !== 0) {
    throw new Error(`builder failed: ${res.stderr || res.stdout}`);
  }
  return JSON.parse(res.stdout.trim()) as Envelope;
}

/** HMAC-подпись произвольного тела — тем же кодом, что и в бою. */
function signBody(body: string): { timestamp: string; signature: string } {
  const py = [
    'import json,os,sys',
    `sys.path.insert(0, ${JSON.stringify(SIDECAR)})`,
    'from app.auth import hmac_sign_headers',
    `body=${JSON.stringify(body)}`,
    'print(json.dumps(hmac_sign_headers(os.environ["PAYMOD_SHARED_SECRET"].encode(), body.encode())))',
  ].join('\n');
  const res = spawnSync(PYTHON, ['-c', py], { cwd: SIDECAR, encoding: 'utf-8' });
  if (res.status !== 0) {
    throw new Error(`sign failed: ${res.stderr || res.stdout}`);
  }
  const headers = JSON.parse(res.stdout.trim()) as Record<string, string>;
  return {
    timestamp: headers['X-Paymod-Timestamp'],
    signature: headers['X-Paymod-Signature'],
  };
}

/**
 * Живой кошелёк из paymod.db: client_ref + выданный адрес.
 *
 * Нужен, чтобы проверить, что sidecar РЕАЛЬНО достаёт `to` по client_ref
 * из настоящей таблицы wallets, а не из мока.
 */
function walletFromPaymodDb(): { client_ref: string; address: string } | null {
  const dbPath =
    process.env.DB_PATH ||
    path.join(SIDECAR, 'paymod.db');
  const py = [
    'import json,sqlite3,sys',
    `con=sqlite3.connect(${JSON.stringify(dbPath)})`,
    'con.row_factory=sqlite3.Row',
    'row=con.execute("SELECT client_ref,address FROM wallets ORDER BY id DESC LIMIT 1").fetchone()',
    'print(json.dumps(dict(row) if row else None))',
  ].join('\n');
  const res = spawnSync(PYTHON, ['-c', py], { encoding: 'utf-8' });
  if (res.status !== 0) {
    throw new Error(`paymod.db read failed: ${res.stderr || res.stdout}`);
  }
  return JSON.parse(res.stdout.trim()) as
    | { client_ref: string; address: string }
    | null;
}

async function post(body: string, timestamp: string, signature: string) {
  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Paymod-Timestamp': timestamp,
      'X-Paymod-Signature': signature,
    },
    body,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function main(): Promise<void> {
  await prisma.$connect();

  const buyer = await prisma.user.create({
    data: {
      phone: `${SUFFIX}-buyer`,
      name: 'H1 live buyer',
      role: 'BUYER',
      referralCode: `${SUFFIX}-buyer`,
    },
  });
  const seller = await prisma.user.create({
    data: {
      phone: `${SUFFIX}-seller`,
      name: 'H1 live seller',
      role: 'SELLER',
      referralCode: `${SUFFIX}-seller`,
    },
  });

  const userIds = [buyer.id, seller.id];
  const orderIds: string[] = [];

  const mkOrder = async (amount: number, address: string) => {
    const order = await prisma.order.create({
      data: {
        buyerId: buyer.id,
        sellerId: seller.id,
        amount,
        status: 'PENDING',
        priceSource: 'PRODUCT',
      },
    });
    orderIds.push(order.id);
    const amountRaw = (
      BigInt(Math.round(amount * 1_000_000)) * 10n ** 12n
    ).toString();
    const clientRef = `mp-txn-${order.id}`;
    const tx = await prisma.transaction.create({
      data: {
        orderId: order.id,
        type: 'payment',
        amount,
        status: 'PENDING',
        provider: 'PAYMOD',
        clientRef,
        depositAddress: address,
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

  const watcherDeposit = (clientRef: string, atomic: number, txHash: string) => ({
    wallet_id: 1,
    client_ref: clientRef,
    network: 'BSC',
    symbol: 'USDT',
    amount: atomic / 1_000_000,
    amount_atomic: atomic,
    tx_hash: txHash,
    is_new: true,
  });

  console.log(`\nwebhook: ${WEBHOOK_URL}`);
  console.log(`suffix:  ${SUFFIX}\n`);

  try {
    // ── 0. payload из реального sidecar-кода ────────────────────────────────
    console.log('[0] payload собирает paymod-sidecar/app/background._on_deposit');
    const probe = buildLiveWebhook(
      watcherDeposit('mp-txn-probe', 1_000_000, '0x' + 'aa'.repeat(32)),
    );
    check(
      'amount_raw = 10^18 (1 USDT в 18 decimals)',
      probe.payload.amount_raw === '1000000000000000000',
      `got ${JSON.stringify(probe.payload.amount_raw)}`,
    );
    check('chain = bsc', probe.payload.chain === 'bsc');
    check(
      'token_address = BSC/USDT контракт',
      probe.payload.token_address ===
        '0x55d398326f99059ff775485246999027b3197955',
    );

    // ── 1. КОНТРОЛЬ: старое тело (amount_raw: "") ───────────────────────────
    console.log('\n[1] контроль — тело СТАРОГО background.py (amount_raw="")');
    {
      const { order, clientRef } = await mkOrder(1, '0xLegacyAddr');
      const body = JSON.stringify({
        event: 'deposit',
        client_ref: clientRef,
        chain: '',
        token: 'USDT',
        token_address: '',
        tx_hash: '0x' + 'b1'.repeat(32),
        from: '',
        to: '',
        amount: 1,
        amount_raw: '',
        block_number: null,
      });
      const sig = spawnSync(
        PYTHON,
        [
          '-c',
          [
            'import json,os,sys',
            `sys.path.insert(0, ${JSON.stringify(SIDECAR)})`,
            'from app.auth import hmac_sign_headers',
            `body=${JSON.stringify(body)}`,
            'print(json.dumps(hmac_sign_headers(os.environ["PAYMOD_SHARED_SECRET"].encode(), body.encode())))',
          ].join('\n'),
        ],
        { cwd: SIDECAR, encoding: 'utf-8' },
      );
      const headers = JSON.parse(sig.stdout.trim()) as Record<string, string>;
      const res = await post(
        body,
        headers['X-Paymod-Timestamp'],
        headers['X-Paymod-Signature'],
      );
      const tx = await prisma.transaction.findFirstOrThrow({
        where: { clientRef },
      });
      const ord = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      check('HTTP 200 + status ok', res.status === 200, JSON.stringify(res));
      check(
        'Transaction PENDING + unverifiable_amount_raw',
        tx.status === 'PENDING' && tx.mismatchReason === 'unverifiable_amount_raw',
        `status=${tx.status} reason=${tx.mismatchReason}`,
      );
      check(
        'Order PENDING, escrow NONE (депозит не подтверждён)',
        ord.status === 'PENDING' && ord.escrowStatus === 'NONE',
        `status=${ord.status} escrow=${ord.escrowStatus}`,
      );
    }

    // ── 2. ЖИВОЙ payload из background.py ───────────────────────────────────
    console.log('\n[2] ЖИВОЙ payload из background.py → POST webhook');
    {
      const { order, clientRef } = await mkOrder(1, '0xLiveAddrH1');
      const txHash = '0x' + 'c1'.repeat(32);
      const env = buildLiveWebhook(watcherDeposit(clientRef, 1_000_000, txHash));

      const res = await post(env.body, env.timestamp, env.signature);
      check('HTTP 200 + status ok', res.status === 200, JSON.stringify(res));

      const tx = await prisma.transaction.findFirstOrThrow({
        where: { clientRef },
      });
      const ord = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      const holds = await prisma.ledgerEntry.findMany({
        where: { orderId: order.id, type: 'escrow_hold' },
      });

      check('Transaction CONFIRMED', tx.status === 'CONFIRMED', `status=${tx.status}`);
      check('mismatchReason пуст', tx.mismatchReason === null);
      check(
        'receivedAmountRaw = 10^18',
        tx.receivedAmountRaw === '1000000000000000000',
        `got ${tx.receivedAmountRaw}`,
      );
      check('confirmedAt проставлен', tx.confirmedAt !== null);
      check('Order PAID', ord.status === 'PAID', `status=${ord.status}`);
      check('escrow HELD', ord.escrowStatus === 'HELD', `escrow=${ord.escrowStatus}`);
      check('escrowAmount = 1', ord.escrowAmount === 1, `got ${ord.escrowAmount}`);
      check('ledger escrow_hold: одна проводка на 1 USDT',
        holds.length === 1 && holds[0].amount === 1,
        `count=${holds.length}`);
    }

    // ── 3. точность 12.34 USDT ─────────────────────────────────────────────
    console.log('\n[3] точность: 12.34 USDT (12_340_000 atomic)');
    {
      const { order, clientRef } = await mkOrder(12.34, '0xPrecisionAddrH1');
      const env = buildLiveWebhook(
        watcherDeposit(clientRef, 12_340_000, '0x' + 'c2'.repeat(32)),
      );
      check(
        'amount_raw = 12340000000000000000',
        env.payload.amount_raw === '12340000000000000000',
        `got ${env.payload.amount_raw}`,
      );
      await post(env.body, env.timestamp, env.signature);
      const ord = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      check(
        'Order PAID + escrow HELD 12.34',
        ord.status === 'PAID' &&
          ord.escrowStatus === 'HELD' &&
          ord.escrowAmount === 12.34,
        `status=${ord.status} escrow=${ord.escrowStatus} amount=${ord.escrowAmount}`,
      );
    }

    // ── 4. подпись обязательна (не «дырявый» эндпоинт) ─────────────────────
    console.log('\n[4] без валидной подписи webhook отклоняется');
    {
      const { clientRef } = await mkOrder(1, '0xNoSigAddrH1');
      const env = buildLiveWebhook(
        watcherDeposit(clientRef, 1_000_000, '0x' + 'c3'.repeat(32)),
      );
      const res = await post(env.body, env.timestamp, 'not-a-signature');
      const tx = await prisma.transaction.findFirstOrThrow({ where: { clientRef } });
      check(
        'rejected invalid_signature, Transaction не тронута',
        res.status === 200 &&
          (res.json as { reason?: string })?.reason === 'invalid_signature' &&
          tx.status === 'PENDING',
        JSON.stringify(res),
      );
    }

    // ══ J3: СВЕРКА АДРЕСА ПОЛУЧАТЕЛЯ ═══════════════════════════════════════
    //
    // До J3 sidecar слал `to: ""` (вендоренный watcher поле не отдаёт) и
    // проверка адреса на бэкенде короткозамыкалась — была МЕРТВА.
    // Теперь sidecar достаёт выданный адрес сам по client_ref.

    // ── 5. sidecar РЕАЛЬНО достаёт адрес из paymod.db ──────────────────────
    console.log('\n[5] sidecar достаёт `to` из paymod.db по client_ref');
    {
      // Живой кошелёк: берём существующий client_ref прямо из paymod.db.
      const wallet = walletFromPaymodDb();
      check(
        'в paymod.db есть кошелёк для живой проверки',
        !!wallet,
        'таблица wallets пуста',
      );

      if (wallet) {
        // deposit-словарь watcher'а — БЕЗ поля `to` (как в бою).
        const env = buildLiveWebhook(
          watcherDeposit(wallet.client_ref, 1_000_000, '0x' + 'd1'.repeat(32)),
        );
        check(
          `payload.to заполнен выданным адресом (${wallet.address})`,
          String(env.payload.to).toLowerCase() === wallet.address.toLowerCase(),
          `got ${JSON.stringify(env.payload.to)}`,
        );
        check(
          'payload.to не пустой — сверка адреса на бэкенде жива',
          env.payload.to !== '',
        );
      }
    }

    // ── 6. `to` НЕ совпадает с depositAddress → REJECT ─────────────────────
    console.log('\n[6] `to` ≠ depositAddress → FAILED address_mismatch');
    {
      const { tx, clientRef } = await mkOrder(1, '0xCorrectDepositAddressJ3');
      const env = buildLiveWebhook(
        watcherDeposit(clientRef, 1_000_000, '0x' + 'd2'.repeat(32)),
      );
      // Подменяем `to` на чужой адрес в СЫРОМ теле и переподписываем —
      // так это выглядел бы, если бы деньги ушли на чужой кошелёк.
      const tampered = { ...env.payload, to: '0xSomeoneElsesWalletJ3' };
      const body = JSON.stringify(tampered);
      const sig = signBody(body);

      const res = await post(body, sig.timestamp, sig.signature);
      const after = await prisma.transaction.findUniqueOrThrow({
        where: { id: tx.id },
      });
      check('HTTP 200', res.status === 200, JSON.stringify(res));
      check(
        'Transaction FAILED + address_mismatch',
        after.status === 'FAILED' && after.mismatchReason === 'address_mismatch',
        `status=${after.status} reason=${after.mismatchReason}`,
      );
      check('Order НЕ оплачен', (await prisma.order.findUniqueOrThrow({
        where: { id: tx.orderId },
      })).status === 'PENDING');
    }

    // ── 7. `to` СОВПАДАЕТ с depositAddress → CONFIRMED ─────────────────────
    console.log('\n[7] `to` = depositAddress → CONFIRMED');
    {
      const addr = '0xMatchingDepositAddrJ3';
      const { order, tx, clientRef } = await mkOrder(1, addr);
      const env = buildLiveWebhook(
        watcherDeposit(clientRef, 1_000_000, '0x' + 'd3'.repeat(32)),
      );
      const body = JSON.stringify({ ...env.payload, to: addr });
      const sig = signBody(body);

      await post(body, sig.timestamp, sig.signature);
      const after = await prisma.transaction.findUniqueOrThrow({
        where: { id: tx.id },
      });
      const ord = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
      });
      check('Transaction CONFIRMED', after.status === 'CONFIRMED', `status=${after.status}`);
      check('Order PAID + escrow HELD', ord.status === 'PAID' && ord.escrowStatus === 'HELD',
        `status=${ord.status} escrow=${ord.escrowStatus}`);
    }

    // ── 8. `to` ПУСТОЙ → обрабатывается, НЕ отклоняется ────────────────────
    console.log('\n[8] пустой `to` → депозит НЕ теряется (обратная совместимость)');
    {
      const addr = '0xEmptyToAddrJ3';
      const { order, tx, clientRef } = await mkOrder(1, addr);
      const env = buildLiveWebhook(
        watcherDeposit(clientRef, 1_000_000, '0x' + 'd4'.repeat(32)),
      );
      const body = JSON.stringify({ ...env.payload, to: '' });
      const sig = signBody(body);

      await post(body, sig.timestamp, sig.signature);
      const after = await prisma.transaction.findUniqueOrThrow({
        where: { id: tx.id },
      });
      const ord = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
      });
      check(
        'Transaction НЕ FAILED (пустой to не отклоняет реальный депозит)',
        after.status !== 'FAILED',
        `status=${after.status} reason=${after.mismatchReason}`,
      );
      check('Transaction CONFIRMED', after.status === 'CONFIRMED', `status=${after.status}`);
      check('Order PAID', ord.status === 'PAID', `status=${ord.status}`);
    }

    // ── 9. chain / token проверки живы (H1 их оживил) ──────────────────────
    console.log('\n[9] неверный chain → reject; неверный token → reject');
    {
      const { tx: txChain, clientRef: refChain } = await mkOrder(1, '0xChainJ3');
      const envC = buildLiveWebhook(
        watcherDeposit(refChain, 1_000_000, '0x' + 'd5'.repeat(32)),
      );
      const bodyC = JSON.stringify({ ...envC.payload, chain: 'eth' });
      const sigC = signBody(bodyC);
      await post(bodyC, sigC.timestamp, sigC.signature);
      const afterChain = await prisma.transaction.findUniqueOrThrow({
        where: { id: txChain.id },
      });
      check(
        'chain=eth → FAILED chain_mismatch',
        afterChain.status === 'FAILED' && afterChain.mismatchReason === 'chain_mismatch',
        `status=${afterChain.status} reason=${afterChain.mismatchReason}`,
      );

      const { tx: txToken, clientRef: refToken } = await mkOrder(1, '0xTokenJ3');
      const envT = buildLiveWebhook(
        watcherDeposit(refToken, 1_000_000, '0x' + 'd6'.repeat(32)),
      );
      const bodyT = JSON.stringify({ ...envT.payload, token: 'USDC' });
      const sigT = signBody(bodyT);
      await post(bodyT, sigT.timestamp, sigT.signature);
      const afterToken = await prisma.transaction.findUniqueOrThrow({
        where: { id: txToken.id },
      });
      check(
        'token=USDC → FAILED token_mismatch',
        afterToken.status === 'FAILED' && afterToken.mismatchReason === 'token_mismatch',
        `status=${afterToken.status} reason=${afterToken.mismatchReason}`,
      );
    }
  } finally {
    await cleanupTestData(
      prisma,
      { userIds, orderIds },
      { prefixes: ['h1live-'], refKeyContains: SUFFIX },
    );
    await prisma.$disconnect();
  }

  console.log(`\nитог: ${failures === 0 ? 'ВСЁ ЗЕЛЁНОЕ' : `${failures} FAIL`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});