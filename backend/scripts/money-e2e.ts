/**
 * Ad-hoc e2e денежного контура (этапы 3-5) против РЕАЛЬНОЙ БД.
 *
 * Проверяет сквозной сценарий:
 *   1. create → феес снапшотятся, инвариант fee+referral+net===amount
 *   2. processSuccessfulPayment → PAID + escrow HELD, продавец 0
 *   3. releaseEscrow → продавец +850, платформа +100, реферер +50, эскроу 0
 *   4. refundEscrow(SPLIT 60) → покупатель +600, продавец +360, платформа +40
 *   5. сиротский депозит → AVAILABLE покупателя
 *   6. withdrawal APPROVE → FAILED → компенсация возвращает баланс
 *
 * Запуск: npx ts-node --compiler-options '{"module":"commonjs"}' scripts/money-e2e.ts
 */
import { PrismaService } from '../src/common/prisma/prisma.service';
import { LedgerService } from '../src/payments/ledger.service';
import { EscrowService } from '../src/payments/escrow.service';
import { SettingsService } from '../src/settings/settings.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { PaymentsService } from '../src/payments/payments.service';
import { computeFees, round2 } from '../src/payments/money.util';

const prisma = new PrismaService();
const notify = {
  createNotification: async () => null,
  sendToUser: async () => null,
} as unknown as NotificationsService;
const ledger = new LedgerService(prisma, notify);
const settings = new SettingsService(prisma);
const escrow = new EscrowService(prisma, ledger, settings, notify);

const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const users: string[] = [];
const orders: string[] = [];
let failures = 0;

function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

async function mkUser(tag: string) {
  const u = await prisma.user.create({
    data: {
      phone: `e2e-${tag}-${suffix}`,
      name: `E2E ${tag}`,
      referralCode: `e2e-${tag}-${suffix}`,
    },
  });
  users.push(u.id);
  return u;
}

async function mkOrder(p: {
  buyerId: string;
  sellerId: string;
  amount: number;
  platformFee: number;
  referralBonus: number;
  referralUserId: string | null;
}) {
  const o = await prisma.order.create({
    data: {
      buyerId: p.buyerId,
      sellerId: p.sellerId,
      amount: p.amount,
      platformFee: p.platformFee,
      referralBonus: p.referralBonus,
      referralUserId: p.referralUserId,
      status: 'PENDING',
    },
  });
  orders.push(o.id);
  return o;
}

async function sumFor(userId: string, account: 'AVAILABLE' | 'REFERRAL' | 'ESCROW' | 'PLATFORM') {
  const agg = await prisma.ledgerEntry.aggregate({
    where: { userId, account },
    _sum: { amount: true },
  });
  return round2(agg._sum.amount ?? 0);
}

async function main() {
  await prisma.$connect();
  console.log('=== E2E денежного контура (этапы 3-5) ===\n');

  // ── 0. Расчёт комиссий (§7.4) ────────────────────────────────
  console.log('[0] computeFees инвариант');
  const fees = computeFees(1000, 10, 5, true);
  check('platformFee=100', fees.platformFee === 100);
  check('referralBonus=50', fees.referralBonus === 50);
  check('sellerNet=850', fees.sellerNet === 850);
  check(
    'fee+referral+net===1000',
    round2(fees.platformFee + fees.referralBonus + fees.sellerNet) === 1000,
  );
  const noRef = computeFees(1000, 10, 5, false);
  check('без реферера bonus=0, net=900', noRef.referralBonus === 0 && noRef.sellerNet === 900);

  // ── 1. Холд эскроу (§4.2, этап 3) ────────────────────────────
  console.log('\n[1] Холд эскроу');
  const buyer = await mkUser('buyer');
  const seller = await mkUser('seller');
  const referrer = await mkUser('referrer');
  const order1 = await mkOrder({
    buyerId: buyer.id,
    sellerId: seller.id,
    amount: 1000,
    platformFee: 100,
    referralBonus: 50,
    referralUserId: referrer.id,
  });

  // Имитируем webhook: PAID + hold (то, что делает processSuccessfulPayment).
  await prisma.order.updateMany({
    where: { id: order1.id, status: 'PENDING' },
    data: { status: 'PAID', paidAt: new Date() },
  });
  const hold = await escrow.holdForOrder(order1.id);
  check('escrow HELD', hold.held && hold.escrowStatus === 'HELD');
  check('escrowAmount=1000', hold.amount === 1000);
  check('продавец AVAILABLE=0 до релиза', (await sumFor(seller.id, 'AVAILABLE')) === 0);
  check('ESCROW покупателя=1000', (await sumFor(buyer.id, 'ESCROW')) === 1000);
  check('autoCompleteAt выставлен', hold.autoCompleteAt instanceof Date);

  // Идемпотентность холда
  const hold2 = await escrow.holdForOrder(order1.id);
  check('повторный холд — no-op', hold2.held === false);
  const escrowRows = await prisma.ledgerEntry.count({ where: { orderId: order1.id, account: 'ESCROW' } });
  check('ровно 1 ESCROW-проводка', escrowRows === 1);

  // ── 2. Релиз эскроу (§4.3, этап 4) ───────────────────────────
  console.log('\n[2] Релиз эскроу (COMPLETED)');
  const rel = await escrow.releaseEscrow(order1.id, 'buyer_confirmed');
  check('released=true', rel.released === true);
  check('sellerNet=850', rel.sellerNet === 850);
  check('продавец AVAILABLE=850', (await sumFor(seller.id, 'AVAILABLE')) === 850);
  check('реферер REFERRAL=50', (await sumFor(referrer.id, 'REFERRAL')) === 50);
  check('ESCROW обнулён', (await sumFor(buyer.id, 'ESCROW')) === 0);
  const platformAgg = await prisma.ledgerEntry.aggregate({
    where: { orderId: order1.id, account: 'PLATFORM' },
    _sum: { amount: true },
  });
  check('платформа +100', round2(platformAgg._sum.amount ?? 0) === 100);
  const o1 = await prisma.order.findUniqueOrThrow({ where: { id: order1.id } });
  check('Order COMPLETED/RELEASED', o1.status === 'COMPLETED' && o1.escrowStatus === 'RELEASED');

  // Двойной релиз
  const rel2 = await escrow.releaseEscrow(order1.id);
  check('повторный релиз — no-op', rel2.released === false);
  check('баланс продавца не удвоился', (await sumFor(seller.id, 'AVAILABLE')) === 850);

  // ── 3. Возврат + SPLIT (§5.1, §5.3) ──────────────────────────
  console.log('\n[3] Возврат (полный и SPLIT)');
  const order2 = await mkOrder({
    buyerId: buyer.id,
    sellerId: seller.id,
    amount: 1000,
    platformFee: 100,
    referralBonus: 0,
    referralUserId: null,
  });
  await escrow.holdForOrder(order2.id);
  const refund = await escrow.refundEscrow(order2.id, 'seller_no_ship_timeout', 100);
  check('toBuyer=1000', refund.toBuyer === 1000);
  check('toSeller=0, feeCut=0', refund.toSeller === 0 && refund.feeCut === 0);
  check('REFUNDED', (await prisma.order.findUniqueOrThrow({ where: { id: order2.id } })).escrowStatus === 'REFUNDED');

  const order3 = await mkOrder({
    buyerId: buyer.id,
    sellerId: seller.id,
    amount: 1000,
    platformFee: 100,
    referralBonus: 0,
    referralUserId: null,
  });
  await escrow.holdForOrder(order3.id);
  const buyerBefore = await sumFor(buyer.id, 'AVAILABLE');
  const split = await escrow.refundEscrow(order3.id, 'arbitration_split', 60);
  check('SPLIT: buyer=600', split.toBuyer === 600);
  check('SPLIT: seller=360', split.toSeller === 360);
  check('SPLIT: fee=40', split.feeCut === 40);
  check('сумма частей = эскроу', round2(split.toBuyer + split.toSeller + split.feeCut) === 1000);
  check('покупатель получил +600', (await sumFor(buyer.id, 'AVAILABLE')) === round2(buyerBefore + 600));
  check('order3 SPLIT', (await prisma.order.findUniqueOrThrow({ where: { id: order3.id } })).escrowStatus === 'SPLIT');

  // ── 4. Сиротский депозит (§5.4) ──────────────────────────────
  console.log('\n[4] Сиротский депозит (заказ отменён)');
  const order4 = await mkOrder({
    buyerId: buyer.id,
    sellerId: seller.id,
    amount: 500,
    platformFee: 50,
    referralBonus: 0,
    referralUserId: null,
  });
  await prisma.order.update({ where: { id: order4.id }, data: { status: 'CANCELLED' } });
  const before4 = await sumFor(buyer.id, 'AVAILABLE');
  await ledger.credit(null, {
    userId: buyer.id,
    account: 'AVAILABLE',
    amount: 500,
    type: 'orphan_deposit',
    refKey: `orphan_deposit:tx:e2e-${suffix}`,
    orderId: order4.id,
  });
  check('сирота зачислена (+500)', (await sumFor(buyer.id, 'AVAILABLE')) === round2(before4 + 500));

  // ── 5. Вывод + компенсация при FAILED (§5.2) ─────────────────
  console.log('\n[5] Вывод и компенсация при FAILED payout');
  const wdUser = await mkUser('wd');
  await ledger.credit(null, {
    userId: wdUser.id,
    account: 'AVAILABLE',
    amount: 300,
    type: 'escrow_release',
    refKey: `e2e-wd-seed:${suffix}`,
  });
  check('сид баланса = 300', (await sumFor(wdUser.id, 'AVAILABLE')) === 300);

  const wr = await prisma.withdrawalRequest.create({
    data: {
      userId: wdUser.id,
      amount: 200,
      status: 'pending',
      toAddress: '0x' + 'a'.repeat(40),
      provider: 'PAYMOD',
    },
  });

  // Списание (как в approveWithdrawal)
  const attempt = 1;
  await prisma.$transaction(async (tx) => {
    await ledger.debit(tx, {
      userId: wdUser.id,
      account: 'AVAILABLE',
      amount: 200,
      type: 'withdrawal_debit',
      refKey: `withdrawal_debit:${wr.id}:AVAILABLE`,
    });
    await tx.withdrawalRequest.update({
      where: { id: wr.id },
      data: { status: 'approved', payoutAttempts: attempt },
    });
  });
  check('после списания AVAILABLE=100', (await sumFor(wdUser.id, 'AVAILABLE')) === 100);

  // Компенсация (как при FAILED)
  await prisma.$transaction(async (tx) => {
    await ledger.credit(tx, {
      userId: wdUser.id,
      account: 'AVAILABLE',
      amount: 200,
      type: 'withdrawal_reversal',
      refKey: `withdrawal_reversal:${wr.id}:${attempt}:AVAILABLE`,
    });
    await tx.withdrawalRequest.update({
      where: { id: wr.id },
      data: { status: 'pending', payoutStatus: 'FAILED', payoutError: 'e2e' },
    });
  });
  check('после компенсации AVAILABLE=300', (await sumFor(wdUser.id, 'AVAILABLE')) === 300);
  const wrFinal = await prisma.withdrawalRequest.findUniqueOrThrow({ where: { id: wr.id } });
  check('заявка снова pending', wrFinal.status === 'pending' && wrFinal.payoutStatus === 'FAILED');

  // ── 6. Инварианты (§2) ───────────────────────────────────────
  console.log('\n[6] Инварианты журнала');
  const report = await ledger.verifyInvariants();
  const ownProblems = report.problems.filter(
    (p) => users.some((u) => p.includes(u)),
  );
  check('нет проблем по нашим пользователям', ownProblems.length === 0, ownProblems.join(' | '));

  // Кэш баланса == журнал для продавца
  const dbSeller = await prisma.user.findUniqueOrThrow({ where: { id: seller.id } });
  check(
    'кэш availableBalance == журнал (seller)',
    round2(dbSeller.availableBalance) === (await sumFor(seller.id, 'AVAILABLE')),
  );

  console.log(`\n=== ${failures === 0 ? 'ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ' : `ПРОВАЛЕНО: ${failures}`} ===`);
}

async function cleanup() {
  try {
    await prisma.ledgerEntry.deleteMany({ where: { orderId: { in: orders } } });
    await prisma.ledgerEntry.deleteMany({ where: { userId: { in: users } } });
    await prisma.withdrawalRequest.deleteMany({ where: { userId: { in: users } } });
    await prisma.notification.deleteMany({ where: { userId: { in: users } } });
    await prisma.order.deleteMany({ where: { id: { in: orders } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  } catch (e) {
    console.error('cleanup error:', (e as Error).message);
  }
  await prisma.$disconnect();
}

main()
  .catch((e) => {
    console.error('E2E FATAL:', e);
    failures++;
  })
  .finally(async () => {
    await cleanup();
    process.exit(failures === 0 ? 0 : 1);
  });