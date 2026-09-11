/**
 * Живая проверка soldEarned (§8.2) против РЕАЛЬНОЙ БД и РЕАЛЬНОГО API.
 *
 * 1. Находит SELLER-пользователя.
 * 2. Через LedgerService.credit (боевой путь) начисляет два escrow_release-
 *    зачисления на AVAILABLE: 850 и 150.
 * 3. Дёргает GET /users/me/stats с реальным JWT и проверяет soldEarned=1000.
 * 4. Дополнительно: withdrawal_debit (-400) НЕ должен уменьшать soldEarned.
 * 5. Чистит за собой.
 */
const { PrismaService } = require('../dist/src/common/prisma/prisma.service');
const { LedgerService } = require('../dist/src/payments/ledger.service');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const env = fs
  .readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
  .split('\n')
  .reduce((a, l) => {
    const i = l.indexOf('=');
    if (i > 0) a[l.slice(0, i).trim()] = l.slice(i + 1).trim();
    return a;
  }, {});

const prisma = new PrismaService();
const notifications = {
  createNotification: async () => null,
  sendToUser: async () => null,
};
const ledger = new LedgerService(prisma, notifications);
const suffix = `soldearned-${Date.now()}`;
let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${name} ${cond ? '' : extra}`);
  if (!cond) failures++;
};

(async () => {
  await prisma.$connect();
  const seller = await prisma.user.findFirst({
    where: { role: 'SELLER' },
    orderBy: { createdAt: 'asc' },
  });
  if (!seller) throw new Error('нет SELLER-пользователя');

  const token = jwt.sign(
    { sub: seller.id, phone: seller.phone, role: seller.role },
    env.JWT_ACCESS_SECRET,
    { expiresIn: '1h' },
  );

  const getStats = async () => {
    const r = await fetch('http://localhost:3000/users/me/stats', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) throw new Error(`stats ${r.status}`);
    return r.json();
  };

  const before = await getStats();
  console.log(`  seller=${seller.phone} soldEarned(до)=${before.soldEarned}`);
  check('поле soldEarned есть в ответе', 'soldEarned' in before);

  await ledger.credit(null, {
    userId: seller.id,
    account: 'AVAILABLE',
    amount: 850,
    type: 'escrow_release',
    refKey: `${suffix}:rel1`,
  });
  await ledger.credit(null, {
    userId: seller.id,
    account: 'AVAILABLE',
    amount: 150,
    type: 'escrow_release',
    refKey: `${suffix}:rel2`,
  });

  const afterSales = await getStats();
  check(
    `soldEarned = до+1000 (${before.soldEarned} -> ${afterSales.soldEarned})`,
    Math.abs(afterSales.soldEarned - (before.soldEarned + 1000)) < 0.01,
    `получено ${afterSales.soldEarned}`,
  );

  // Вывод средств не должен «просаживать» заработанное за всё время.
  await ledger.debit(null, {
    userId: seller.id,
    account: 'AVAILABLE',
    amount: 400,
    type: 'withdrawal_debit',
    refKey: `${suffix}:wd`,
  });
  const afterWd = await getStats();
  check(
    'withdrawal_debit не уменьшает soldEarned',
    Math.abs(afterWd.soldEarned - afterSales.soldEarned) < 0.01,
    `${afterSales.soldEarned} -> ${afterWd.soldEarned}`,
  );

  // Чистка: проводки + пересчёт кэша баланса.
  await prisma.ledgerEntry.deleteMany({ where: { refKey: { startsWith: suffix } } });
  const agg = await prisma.ledgerEntry.aggregate({
    where: { userId: seller.id, account: 'AVAILABLE' },
    _sum: { amount: true },
  });
  await prisma.user.update({
    where: { id: seller.id },
    data: { availableBalance: Math.round((agg._sum.amount ?? 0) * 100) / 100 },
  });

  const afterCleanup = await getStats();
  check(
    `после чистки soldEarned вернулся к ${before.soldEarned}`,
    Math.abs(afterCleanup.soldEarned - before.soldEarned) < 0.01,
    `получено ${afterCleanup.soldEarned}`,
  );

  await prisma.$disconnect();
  console.log(`\n=== ${failures === 0 ? 'ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ' : `ПРОВАЛЕНО: ${failures}`} ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error('FATAL:', e);
  await prisma.$disconnect();
  process.exit(1);
});