/**
 * K1 — живой прогон reconcileUnheldEscrow против РЕАЛЬНОЙ БД.
 *
 * Режим задаётся argv[2]: 'dry' (по умолчанию) | 'apply'.
 * Никакой логики сверх вызова сервиса — чтобы проверка была настоящей,
 * а не повторной реализацией.
 *
 * Запуск:
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/k1-reconcile-live.ts dry
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/k1-reconcile-live.ts apply
 */
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AuditService } from '../src/common/audit/audit.service';
import { SettingsService } from '../src/settings/settings.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { LedgerService } from '../src/payments/ledger.service';
import { EscrowService } from '../src/payments/escrow.service';
import { PaymentsService } from '../src/payments/payments.service';
import {
  OrdersService,
  ESCROW_RECONCILE_APPLY_SETTING,
} from '../src/marketplace/orders.service';

const prisma = new PrismaService();

const notify = {
  createNotification: async () => null,
  sendToUser: async () => null,
} as unknown as NotificationsService;

const settings = new SettingsService(prisma);
const ledger = new LedgerService(prisma, notify);
const audit = new AuditService(prisma);
const escrow = new EscrowService(prisma, ledger, settings, notify);
const payments = new PaymentsService(
  prisma,
  settings,
  { createPayment: async () => ({}) } as any,
  { createPayment: async () => ({}) } as any,
  { getTxStatus: async () => ({}) } as any,
  ledger,
  notify,
  escrow,
  undefined,
);
const orders = new OrdersService(
  prisma,
  audit,
  payments,
  escrow,
  settings,
  notify,
);

const stub = {
  info: (m: string) => console.log(`[log]   ${m}`),
  warn: (m: string) => console.log(`[warn]  ${m}`),
  error: (m: string) => console.log(`[error] ${m}`),
  debug: () => undefined,
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(orders as any).logger = stub;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(escrow as any).logger = stub;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(ledger as any).logger = stub;

async function snapshot(label: string) {
  const rows = await prisma.$queryRawUnsafe<
    Array<{ status: string; escrowStatus: string; n: bigint }>
  >(
    `SELECT status::text, "escrowStatus"::text, count(*)::bigint AS n
       FROM "Order" GROUP BY 1,2 ORDER BY 1,2`,
  );
  const total = await prisma.order.count();
  const stuck = await prisma.order.count({
    where: {
      status: { in: ['PAID', 'SHIPPED'] as never[] },
      escrowStatus: 'NONE',
    },
  });
  const ledgerRows = await prisma.ledgerEntry.count();
  const ledgerEscrowSum = await prisma.ledgerEntry.aggregate({
    where: { account: 'ESCROW' },
    _sum: { amount: true },
  });
  console.log(`\n===== ${label} =====`);
  for (const r of rows) {
    console.log(`  ${r.status.padEnd(10)} / ${r.escrowStatus.padEnd(9)} = ${r.n}`);
  }
  console.log(`  TOTAL orders        = ${total}`);
  console.log(`  PAID/SHIPPED + NONE = ${stuck}`);
  console.log(`  LedgerEntry rows    = ${ledgerRows}`);
  console.log(`  Ledger ESCROW sum   = ${ledgerEscrowSum._sum.amount ?? 0}`);
  return { total, stuck, ledgerRows };
}

async function main() {
  const mode = (process.argv[2] ?? 'dry').toLowerCase();

  const settingBefore = await settings.get(ESCROW_RECONCILE_APPLY_SETTING);
  console.log(`setting ${ESCROW_RECONCILE_APPLY_SETTING} = ${settingBefore}`);
  const before = await snapshot(`BEFORE (mode=${mode})`);

  if (mode === 'invariants') {
    const rep = await ledger.verifyInvariants();
    console.log(`\n--- verifyInvariants ---`);
    console.log(`ok=${rep.ok} problems=${rep.problems.length} warnings=${rep.warnings.length}`);
    console.log('totals:', JSON.stringify(rep.totals));
    rep.problems.slice(0, 10).forEach((p) => console.log('  PROBLEM:', p));
    rep.warnings.slice(0, 5).forEach((p) => console.log('  warning:', p));
    const mism = await ledger.findEscrowMismatches();
    console.log(`escrow mismatches = ${mism.length}`);
    mism.slice(0, 5).forEach((m) => console.log('  ', JSON.stringify(m)));
    await prisma.$disconnect();
    return;
  }

  if (mode === 'apply') {
    console.log('REFUSED: raw apply-ветка переводит 654 в PENDING, откуда');
    console.log('cancelExpiredOrders (createdAt=01.08 < now-15m) превратит их');
    console.log('в CANCELLED. Необратимо. Используй scripts/k1-apply-fix.ts.');
    await prisma.$disconnect();
    return;
  }

  if (mode === 'reconcile-apply') {
    // РЕАЛЬНЫЙ apply-прогон reconciler'а (после фикса он не должен ничего
    // найти). Безопасен ровно потому, что чинить нечего.
    let scanned = 0;
    let held = 0;
    let reverted = 0;
    let failed = 0;
    for (let i = 0; i < 40; i++) {
      const report = await orders.reconcileUnheldEscrow({ apply: true, batchSize: 100 });
      scanned += report.scanned;
      held += report.held;
      reverted += report.reverted;
      failed += report.failed;
      console.log(`batch#${i}: scanned=${report.scanned} held=${report.held} reverted=${report.reverted} failed=${report.failed}`);
      if (report.scanned === 0) break;
    }
    console.log(`\n--- reconcile apply=true total: scanned=${scanned} held=${held} reverted=${reverted} failed=${failed}`);
    await snapshot('AFTER reconcile apply=true');
    await prisma.$disconnect();
    return;
  }

  if (mode !== 'dry') {
    console.log(`unknown mode: ${mode}`);
    await prisma.$disconnect();
    return;
  }

  {
    const report = await orders.reconcileUnheldEscrow({ apply: false });
    console.log('\n--- DRY-RUN report ---');
    console.log(JSON.stringify({ ...report, orderIds: undefined }, null, 2));
    console.log(`  caseA (withConfirmedTx) = ${report.withConfirmedTx}`);
    console.log(`  caseB (withoutConfirmedTx) = ${report.withoutConfirmedTx}`);
    const after = await snapshot('AFTER DRY-RUN');
    console.log(
      `\nDRY-RUN mutation check: stuck ${before.stuck} -> ${after.stuck} ` +
        `(delta ${after.stuck - before.stuck}), ledger ${before.ledgerRows} -> ${after.ledgerRows}`,
    );
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});