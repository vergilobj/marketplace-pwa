/**
 * K1 — живая проверка UI-последствий через РЕАЛЬНЫЙ GET /orders/my.
 *
 * Запуск: node scripts/k1-ui-history-check.js [phone1 phone2 ...]
 * Без аргументов берёт 5 покупателей из бывших 654 из БД.
 */
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');

const backend = path.join(__dirname, '..');
const env = fs
  .readFileSync(path.join(backend, '.env'), 'utf8')
  .split('\n')
  .reduce((a, l) => {
    const i = l.indexOf('=');
    if (i > 0) a[l.slice(0, i).trim()] = l.slice(i + 1).trim();
    return a;
  }, {});

const { PrismaService } = require('../dist/src/common/prisma/prisma.service');
const prisma = new PrismaService();

const URL = 'http://localhost:3000/orders/my';

async function call(phone, id, role) {
  const token = jwt.sign({ sub: id, phone, role }, env.JWT_ACCESS_SECRET, {
    expiresIn: '1h',
  });
  const r = await fetch(URL, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return { phone, http: r.status, error: true };
  const arr = await r.json();
  const by = {};
  for (const o of arr) by[o.status] = (by[o.status] || 0) + 1;
  return { phone, http: r.status, total: arr.length, by };
}

(async () => {
  await prisma.$connect();

  const phones = process.argv.slice(2);
  let rows;
  if (phones.length) {
    rows = await prisma.user.findMany({
      where: { phone: { in: phones } },
      select: { id: true, phone: true, role: true },
    });
  } else {
    // покупатели, чьи заказы были в 654 и стали COMPLETED
    rows = await prisma.$queryRawUnsafe(
      `SELECT u.id, u.phone, u.role::text AS role, count(*)::int AS n
         FROM "Order" o JOIN "User" u ON u.id = o."buyerId"
        WHERE o.status='COMPLETED' AND o."escrowStatus"='NONE'
          AND o."createdAt" < '2026-08-02'
        GROUP BY 1,2,3 ORDER BY n DESC LIMIT 5`,
    );
  }

  console.log(`\n=== GET ${URL} — история ПОСЛЕ фикса ===`);
  let lost = 0;
  for (const u of rows) {
    const dbCount = await prisma.order.count({ where: { buyerId: u.id } });
    const res = await call(u.phone, u.id, u.role);
    const shown = res.total ?? 0;
    const ok = shown === dbCount;
    if (!ok) lost += dbCount - shown;
    console.log(
      `  ${String(u.phone).padEnd(14)} роль=${String(u.role).padEnd(7)} ` +
        `в БД=${String(dbCount).padEnd(3)} в API=${String(shown).padEnd(3)} ` +
        `${ok ? 'OK' : 'ПОТЕРЯ ' + (dbCount - shown)}  статусы=${JSON.stringify(res.by)}`,
    );
  }
  console.log(
    `\nИТОГ: покупателей=${rows.length}, потеряно записей в выдаче=${lost} ` +
      `${lost === 0 ? '→ история НЕ потеряна' : '→ ИСТОРИЯ ТЕРЯЕТСЯ'}`,
  );

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('FATAL:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});