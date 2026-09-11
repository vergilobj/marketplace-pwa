/**
 * Живая проверка алерт-канала (§2 ТЗ) против РЕАЛЬНОЙ БД и РЕАЛЬНОГО API.
 *
 * 1. Создаёт временного ADMIN и временного юзера, у которого ломает кэш
 *    availableBalance (инвариант (1) гарантированно нарушен).
 * 2. Гоняет боевой cron-путь ledger.runInvariantCheck() с настоящим
 *    NotificationsService (пишет в таблицу Notification).
 * 3. Проверяет, что алерт ДОСТАВЛЕН: GET /notifications под JWT админа
 *    содержит запись type=money_alert с описанием нарушения.
 * 4. Чистит за собой.
 */
const { PrismaService } = require('../dist/src/common/prisma/prisma.service');
const { LedgerService } = require('../dist/src/payments/ledger.service');
const {
  NotificationsService,
} = require('../dist/src/notifications/notifications.service');
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
// Реальный ConfigService не нужен: OneSignal-ключей в проверке нет,
// push не шлём — важна запись в таблице Notification.
const config = { get: () => undefined };
const notifications = new NotificationsService(config, prisma);
const ledger = new LedgerService(prisma, notifications);

const suffix = `alert-${Date.now()}`;
const created = [];
let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${name} ${cond ? '' : extra}`);
  if (!cond) failures++;
};

(async () => {
  await prisma.$connect();

  const admin = await prisma.user.create({
    data: {
      phone: `alert-admin-${suffix}`,
      name: 'Alert Admin',
      referralCode: `alert-admin-${suffix}`,
      role: 'ADMIN',
    },
  });
  created.push(admin.id);

  const victim = await prisma.user.create({
    data: {
      phone: `alert-victim-${suffix}`,
      name: 'Alert Victim',
      referralCode: `alert-victim-${suffix}`,
      role: 'SELLER',
    },
  });
  created.push(victim.id);

  // Реальная проводка + испорченный кэш → нарушение инварианта (1).
  await ledger.credit(null, {
    userId: victim.id,
    account: 'AVAILABLE',
    amount: 777,
    type: 'escrow_release',
    refKey: `${suffix}:credit`,
  });
  await prisma.user.update({
    where: { id: victim.id },
    data: { availableBalance: 999999 },
  });

  console.log('  запуск боевого runInvariantCheck()...');
  const res = await ledger.runInvariantCheck();
  check('runInvariantCheck увидел нарушение (ok=false)', res.ok === false);

  // Запись в БД — то, что читает GET /notifications.
  const stored = await prisma.notification.findFirst({
    where: { userId: admin.id, type: 'money_alert' },
    orderBy: { createdAt: 'desc' },
  });
  check('Notification для ADMIN создана', stored !== null);
  check(
    'текст алерта содержит id нарушителя',
    Boolean(stored && stored.message.includes(victim.id)),
    stored ? stored.message.slice(0, 120) : '',
  );

  // Доставка через РЕАЛЬНЫЙ API под JWT админа.
  const token = jwt.sign(
    { sub: admin.id, phone: admin.phone, role: admin.role },
    env.JWT_ACCESS_SECRET,
    { expiresIn: '1h' },
  );
  const r = await fetch('http://localhost:3000/notifications', {
    headers: { Authorization: `Bearer ${token}` },
  });
  check(`GET /notifications -> 200 (получено ${r.status})`, r.ok);
  const list = await r.json();
  const arr = Array.isArray(list) ? list : list.items || [];
  const apiAlert = arr.find((n) => n.type === 'money_alert');
  check('алерт виден в /notifications', Boolean(apiAlert));
  check(
    'алерт помечен непрочитанным (isRead=false)',
    Boolean(apiAlert && apiAlert.isRead === false),
  );

  // Дедуп: повторный прогон не должен создать вторую запись.
  const countBefore = await prisma.notification.count({
    where: { userId: admin.id, type: 'money_alert' },
  });
  await ledger.runInvariantCheck();
  const countAfter = await prisma.notification.count({
    where: { userId: admin.id, type: 'money_alert' },
  });
  check(
    `дедуп за час: ${countBefore} -> ${countAfter}`,
    countBefore === countAfter,
  );

  // Чистка.
  await prisma.notification.deleteMany({ where: { userId: { in: created } } });
  await prisma.ledgerEntry.deleteMany({
    where: { userId: { in: created } },
  });
  await prisma.user.deleteMany({ where: { id: { in: created } } });

  await prisma.$disconnect();
  console.log(
    `\n=== ${failures === 0 ? 'ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ' : `ПРОВАЛЕНО: ${failures}`} ===`,
  );
  process.exit(failures === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error('FATAL:', e);
  await prisma.$disconnect();
  process.exit(1);
});