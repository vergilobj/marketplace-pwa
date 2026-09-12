/**
 * K1 — эмпирическое доказательство риска PENDING-ветки reconciler'а.
 *
 * Создаёт ОДИН тестовый PENDING-заказ с createdAt = 2026-08-01 (как 654)
 * и показывает, что боевой крон `cancelExpiredOrders` (@Cron EVERY_30_SECONDS)
 * его отменяет. Затем чистит за собой.
 *
 * Это доказательство того, что `reconcileUnheldEscrow({apply:true})` —
 * который переводит 654 заказа в PENDING — привёл бы к их необратимой
 * отмене в течение 30 секунд.
 *
 * Запуск: node scripts/k1-prove-pending-risk.js
 */
const path = require('path');
const { PrismaService } = require('../dist/src/common/prisma/prisma.service');
const prisma = new PrismaService();

const SUFFIX = `k1-pending-${Date.now()}`;

(async () => {
  await prisma.$connect();

  const buyer = await prisma.user.create({
    data: {
      phone: `${SUFFIX}-buyer`,
      name: 'K1 Pending Risk Buyer',
      role: 'BUYER',
      referralCode: `${SUFFIX}-b`,
    },
  });
  const seller = await prisma.user.create({
    data: {
      phone: `${SUFFIX}-seller`,
      name: 'K1 Pending Risk Seller',
      role: 'SELLER',
      referralCode: `${SUFFIX}-s`,
    },
  });

  // createdAt в прошлом — ровно как у 654 легаси-заказов (2026-08-01)
  const order = await prisma.order.create({
    data: {
      buyerId: buyer.id,
      sellerId: seller.id,
      amount: 100,
      status: 'PENDING',
      escrowStatus: 'NONE',
      createdAt: new Date('2026-08-01T04:43:26.851Z'),
    },
  });

  console.log(`order=${order.id}`);
  console.log(`createdAt=${order.createdAt.toISOString()} status=${order.status}`);
  console.log(
    `\nТеперь ждём боевой крон cancelExpiredOrders (EVERY_30_SECONDS)...`,
  );

  const t0 = Date.now();
  let status = order.status;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const cur = await prisma.order.findUnique({
      where: { id: order.id },
      select: { status: true, cancelledAt: true },
    });
    status = cur.status;
    if (status !== 'PENDING') {
      console.log(
        `\nЧерез ${((Date.now() - t0) / 1000).toFixed(1)}с крон перевёл заказ: ` +
          `PENDING → ${status} (cancelledAt=${cur.cancelledAt?.toISOString()})`,
      );
      console.log(
        `\nВЫВОД ПОДТВЕРЖДЁН: заказ PENDING со старым createdAt необратимо ` +
          `отменяется боевым кроном. reconcileUnheldEscrow({apply:true}) ` +
          `перевёл бы 654 легаси-заказа в PENDING → все стали бы CANCELLED ` +
          `в пределах ~30 секунд.`,
      );
      break;
    }
  }
  if (status === 'PENDING') {
    console.log(
      `\nКрон не сработал за 80с — проверь, что бэкенд запущен (порт 3000).`,
    );
  }

  // cleanup
  await prisma.order.deleteMany({ where: { buyerId: buyer.id } });
  await prisma.user.deleteMany({ where: { id: { in: [buyer.id, seller.id] } } });
  console.log(`\ncleanup: тестовые user/order удалены`);
  const left = await prisma.user.count({
    where: { phone: { startsWith: SUFFIX } },
  });
  console.log(`проверка чистоты: осталось ${left} (ожидается 0)`);

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('FATAL:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});