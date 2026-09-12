/**
 * K1 — закрытие 654 легаси-заказов «PAID/SHIPPED + escrowStatus=NONE».
 *
 * ПОЧЕМУ НЕ reconcileUnheldEscrow({ apply: true }):
 * его ветка (б) переводит заказ в `PENDING` + `paidAt: null`. Но
 * `cancelExpiredOrders` (@Cron EVERY_30_SECONDS) отменяет всё, где
 * `status='PENDING' AND createdAt < now() - order_payment_ttl_minutes(15)`.
 * `createdAt` у всех 654 = 2026-08-01, т.е. просрочены на месяц →
 * ВСЕ 654 стали бы `CANCELLED` в течение 30 секунд после apply. Это
 * необратимая потеря истории у 394 покупателей и 100 продавцов.
 * (Комментарий в самом orders.service.ts:921-925 это признаёт.)
 *
 * ПОЧЕМУ НЕ «hold + RELEASED» (полная имитация):
 * все 654 — case (б): подтверждённых Transaction НЕТ НИ ОДНОЙ (проверено
 * dry-run'ом: 654/0). Создавать им холд и релиз = рисовать в леджере
 * оборот 654 × ~128k = ~84 млн USDT, которого не было. Это отравило бы
 * инварианты, `soldEarned` продавцов и «доход платформы». Денег не было —
 * в леджер не пишем.
 *
 * ПОЧЕМУ COMPLETED (вариант «в» из ТЗ):
 *  - ТЗ: «создать завершённые заказы (COMPLETED + escrowStatus: RELEASED) с
 *    корректным ledger — это исторические заказы „для вида“». RELEASED+ledger
 *    отвергнуты: холдов не было (см. выше), а RELEASED с нулевым леджером
 *    сломал бы `findEscrowMismatches` (для HELD требует ledgerEscrow>0; для
 *    RELEASED/REFUNDED/SPLIT — ledgerEscrow==0, т.е. формально прошло бы, но
 *    это ложь в реестре: RELEASED без единой проводки).
 *  - COMPLETED + NONE — ровно тот стейт, в котором уже лежат 513 собратьев
 *    этих же заказов (проверено: COMPLETED+NONE = 513, escrowAmount=0,
 *    ledger=0). Итог: 654 + 513 = 1167 COMPLETED, консистентно.
 *  - Семантика честная: заказ исторический, закрыт, денег в системе нет.
 *    Продавец в реальности получил оплату вне платформы — это ровно то, что
 *    означает COMPLETED+NONE у соседних 513.
 *  - НЕ ломает инварианты: `findEscrowMismatches` фильтрует
 *    `escrowStatus != NONE` → эти заказы вне выборки; ledger ESCROW=0 ==
 *    сумма escrowAmount по HELD=0. `verifyInvariants` остаётся ok=true
 *    (замерено ДО: problems=0).
 *
 * ИДЕМПОТЕНТНОСТЬ: `updateMany` с полным набором условий
 * (`status IN (PAID,SHIPPED) AND escrowStatus = NONE`) + `completedAt IS NULL`.
 * Повторный прогон не пишет ни строки.
 *
 * ОТКАТ: /tmp/forge/20260912_audit/K1/backup/ (полный дамп + CSV 654 строк).
 *
 * Запуск:
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/k1-apply-fix.ts          # dry
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/k1-apply-fix.ts --apply
 */
import { PrismaService } from '../src/common/prisma/prisma.service';

const prisma = new PrismaService();
const APPLY = process.argv.includes('--apply');
const BATCH = 100;

const STUCK = {
  status: { in: ['PAID', 'SHIPPED'] as never[] },
  escrowStatus: 'NONE' as never,
};

async function stats(label: string) {
  const rows = await prisma.$queryRawUnsafe<
    Array<{ status: string; escrowStatus: string; n: bigint }>
  >(
    `SELECT status::text, "escrowStatus"::text, count(*)::bigint AS n
       FROM "Order" GROUP BY 1,2 ORDER BY 1,2`,
  );
  const total = await prisma.order.count();
  const stuck = await prisma.order.count({ where: STUCK });
  const completed = await prisma.order.count({
    where: { status: 'COMPLETED' as never },
  });
  const ledger = await prisma.ledgerEntry.count();
  const escrowSum = await prisma.ledgerEntry.aggregate({
    where: { account: 'ESCROW' as never },
    _sum: { amount: true },
  });
  console.log(`\n===== ${label} =====`);
  for (const r of rows) console.log(`  ${r.status.padEnd(10)}/${r.escrowStatus.padEnd(9)} = ${r.n}`);
  console.log(`  TOTAL=${total}  COMPLETED=${completed}  STUCK=${stuck}`);
  console.log(`  LedgerEntry=${ledger}  ESCROW sum=${escrowSum._sum.amount ?? 0}`);
  return { total, stuck, completed, ledger };
}

async function main() {
  const before = await stats(`BEFORE (apply=${APPLY})`);

  if (before.stuck === 0) {
    console.log('\nSTUCK = 0 — чинить нечего (идемпотентно).');
    await prisma.$disconnect();
    return;
  }

  // Защита: не трогаем заказы, у которых ЕСТЬ подтверждённая транзакция —
  // такие обязан чинить reconciler (ветка «а»), а не этот скрипт.
  const funded = await prisma.order.findMany({
    where: STUCK,
    select: { id: true },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  const fundedIds = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT o.id FROM "Order" o
      WHERE o.status IN ('PAID','SHIPPED') AND o."escrowStatus"='NONE'
        AND EXISTS (SELECT 1 FROM "Transaction" t
                     WHERE t."orderId"=o.id
                       AND t.status::text IN ('CONFIRMED','OVERPAID','SWEPT'))`,
  );
  if (fundedIds.length > 0) {
    console.error(
      `\nОТКАЗ: ${fundedIds.length} заказ(ов) имеют подтверждённый депозит — ` +
        `их должен обработать reconcileUnheldEscrow (ветка «а»), не этот скрипт.`,
    );
    console.error(fundedIds.slice(0, 5).map((r) => r.id).join('\n'));
    await prisma.$disconnect();
    process.exit(2);
  }
  void funded;

  if (!APPLY) {
    console.log(
      `\nDRY: перевёл бы ${before.stuck} заказов PAID/SHIPPED+NONE → COMPLETED+NONE` +
        `\n     (completedAt=now(), autoCompleteAt=null). Ledger НЕ трогается.` +
        `\n     Запусти с --apply для реального прогона.`,
    );
    await prisma.$disconnect();
    return;
  }

  // ---- реальный прогон, батчами ----
  const touched: string[] = [];
  let guard = 0;
  for (;;) {
    const batch = await prisma.order.findMany({
      where: STUCK,
      select: { id: true },
      orderBy: { id: 'asc' },
      take: BATCH,
    });
    if (batch.length === 0) break;
    const ids = batch.map((o) => o.id);
    const now = new Date();
    const res = await prisma.order.updateMany({
      where: {
        id: { in: ids },
        status: { in: ['PAID', 'SHIPPED'] as never[] },
        escrowStatus: 'NONE' as never,
        completedAt: null,
      },
      data: {
        status: 'COMPLETED' as never,
        completedAt: now,
        autoCompleteAt: null,
      },
    });
    touched.push(...ids);
    console.log(`batch#${guard}: ids=${ids.length} updated=${res.count}`);
    if (++guard > 40) {
      console.error('guard: стоп после 40 батчей');
      break;
    }
  }
  console.log(`\nВсего затронуто id: ${touched.length}`);

  const after = await stats('AFTER');
  const ledgerAfter = await prisma.ledgerEntry.count();

  console.log('\n--- ИТОГ ---');
  console.log(`  STUCK      ${before.stuck} -> ${after.stuck}   ${after.stuck === 0 ? 'OK' : 'FAIL'}`);
  console.log(`  TOTAL      ${before.total} -> ${after.total}   ${after.total === before.total ? 'OK (ничего не удалено)' : 'FAIL'}`);
  console.log(`  LedgerEntry ${before.ledger} -> ${ledgerAfter}  ${ledgerAfter === before.ledger ? 'OK (леджер не тронут)' : 'FAIL'}`);
  console.log(`  COMPLETED  ${before.completed} -> ${after.completed} (+${after.completed - before.completed})`);

  // Инвариант: COMPLETED+NONE не должен попасть в findEscrowMismatches
  const mism = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT count(*)::bigint AS n FROM "Order"
      WHERE "escrowStatus" <> 'NONE'
        AND "escrowStatus" = 'HELD'
        AND COALESCE((SELECT sum(l.amount) FROM "LedgerEntry" l
                       WHERE l."orderId"="Order".id AND l.account='ESCROW'),0) <= 0`,
  );
  console.log(`  HELD без леджера (mismatch) = ${mism[0]?.n ?? 0}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});