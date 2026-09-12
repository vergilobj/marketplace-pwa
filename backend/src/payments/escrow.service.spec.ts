/**
 * Интеграционные тесты EscrowService (§8.1 ТЗ): холд / релиз / возврат /
 * сплит / гонки. Против реальной БД — идемпотентность и атомарные гарды
 * проверяются только на настоящих транзакциях и unique-констрейнтах.
 */
import { EscrowStatus, LedgerAccount, OrderStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { cleanupTestData } from '../common/prisma/test-db-cleanup';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LedgerService } from './ledger.service';
import { EscrowService, escrowSplitInvariant } from './escrow.service';
import { addDays, round2 } from './money.util';

describe('EscrowService (integration)', () => {
  const prisma = new PrismaService();

  // Уведомления глушим: тест про деньги, не про OneSignal.
  const notify = {
    createNotification: jest.fn().mockResolvedValue(null),
    sendToUser: jest.fn().mockResolvedValue(null),
  } as unknown as NotificationsService;

  const ledger = new LedgerService(prisma, notify);
  const settings = new SettingsService(prisma);

  const escrow = new EscrowService(prisma, ledger, settings, notify);

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const createdUserIds: string[] = [];
  const createdOrderIds: string[] = [];

  const mkUser = async (name: string) => {
    const user = await prisma.user.create({
      data: {
        phone: `escrow-test-${name}-${suffix}`,
        name: `Escrow Test ${name}`,
        referralCode: `et-${name}-${suffix}`,
      },
    });
    createdUserIds.push(user.id);
    return user;
  };

  const mkOrder = async (params: {
    buyerId: string;
    sellerId: string;
    amount: number;
    platformFee?: number;
    referralBonus?: number;
    referralUserId?: string | null;
    status?: OrderStatus;
  }) => {
    const order = await prisma.order.create({
      data: {
        buyerId: params.buyerId,
        sellerId: params.sellerId,
        amount: params.amount,
        platformFee: params.platformFee ?? 0,
        referralBonus: params.referralBonus ?? 0,
        referralUserId: params.referralUserId ?? null,
        status: params.status ?? OrderStatus.PENDING,
      },
    });
    createdOrderIds.push(order.id);
    return order;
  };

  const sumFor = async (userId: string, account: LedgerAccount) => {
    const agg = await prisma.ledgerEntry.aggregate({
      where: { userId, account },
      _sum: { amount: true },
    });
    return round2(agg._sum.amount ?? 0);
  };

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    // Полная уборка (W1 §2): escrow-тесты создают User/Order, но трогают и
    // LedgerEntry без userId (PLATFORM-проводки) — точечный deleteMany по
    // трекингу их не ловил, и они накапливались между прогонами.
    await cleanupTestData(
      prisma,
      {
        userIds: createdUserIds,
        orderIds: createdOrderIds,
      },
      { prefixes: ['escrow-test-'] },
    );
    await prisma.$disconnect();
  });

  // ============================================================
  // Холд (§4.2)
  // ============================================================

  describe('holdForOrder', () => {
    it('морозит деньги: escrowStatus=HELD, баланс продавца = 0', async () => {
      const buyer = await mkUser('hold-buyer');
      const seller = await mkUser('hold-seller');
      const order = await mkOrder({
        buyerId: buyer.id,
        sellerId: seller.id,
        amount: 1000,
        platformFee: 100,
      });

      const result = await escrow.holdForOrder(order.id);

      expect(result.held).toBe(true);
      expect(result.amount).toBe(1000);
      expect(result.escrowStatus).toBe(EscrowStatus.HELD);
      expect(result.autoCompleteAt).toBeInstanceOf(Date);

      const updated = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(updated.escrowStatus).toBe(EscrowStatus.HELD);
      expect(updated.escrowAmount).toBe(1000);
      expect(updated.escrowHeldAt).toBeInstanceOf(Date);

      // Дедлайн отправки = +5 дней (escrow_ship_deadline_days).
      const expectedDeadline = addDays(new Date(), 5);
      const diffMs = Math.abs(
        (updated.autoCompleteAt as Date).getTime() - expectedDeadline.getTime(),
      );
      expect(diffMs).toBeLessThan(60_000);

      // Ключевой инвариант: продавец НЕ получил денег до подтверждения.
      expect(await sumFor(seller.id, LedgerAccount.AVAILABLE)).toBe(0);
      expect(await sumFor(buyer.id, LedgerAccount.ESCROW)).toBe(1000);
    });

    it('идемпотентен: повторный вызов не дублирует холд', async () => {
      const buyer = await mkUser('hold2-buyer');
      const seller = await mkUser('hold2-seller');
      const order = await mkOrder({
        buyerId: buyer.id,
        sellerId: seller.id,
        amount: 500,
      });

      const first = await escrow.holdForOrder(order.id);
      const second = await escrow.holdForOrder(order.id);

      expect(first.held).toBe(true);
      expect(second.held).toBe(false);

      const rows = await prisma.ledgerEntry.findMany({
        where: { orderId: order.id },
      });
      expect(rows).toHaveLength(1);
    });

    it('два параллельных холда — одна проводка (гонка webhook)', async () => {
      const buyer = await mkUser('holdrace-buyer');
      const seller = await mkUser('holdrace-seller');
      const order = await mkOrder({
        buyerId: buyer.id,
        sellerId: seller.id,
        amount: 600,
      });

      const results = await Promise.all([
        escrow.holdForOrder(order.id),
        escrow.holdForOrder(order.id),
      ]);

      expect(results.filter((r) => r.held)).toHaveLength(1);

      const rows = await prisma.ledgerEntry.findMany({
        where: { orderId: order.id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].amount).toBe(600);

      const updated = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(updated.escrowAmount).toBe(600);
    });
  });

  // ============================================================
  // Релиз (§4.3)
  // ============================================================

  describe('releaseEscrow', () => {
    it('COMPLETED: продавец +850, платформа +100, реферер +50, эскроу 0', async () => {
      const buyer = await mkUser('rel-buyer');
      const seller = await mkUser('rel-seller');
      const referrer = await mkUser('rel-referrer');
      const order = await mkOrder({
        buyerId: buyer.id,
        sellerId: seller.id,
        amount: 1000,
        platformFee: 100,
        referralBonus: 50,
        referralUserId: referrer.id,
      });

      await escrow.holdForOrder(order.id);
      const result = await escrow.releaseEscrow(order.id, 'buyer_confirmed');

      expect(result.released).toBe(true);
      expect(result.sellerNet).toBe(850);
      expect(result.platformFee).toBe(100);
      expect(result.referralBonus).toBe(50);

      expect(await sumFor(seller.id, LedgerAccount.AVAILABLE)).toBe(850);
      expect(await sumFor(referrer.id, LedgerAccount.REFERRAL)).toBe(50);
      expect(await sumFor(buyer.id, LedgerAccount.ESCROW)).toBe(0);

      const updated = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(updated.status).toBe(OrderStatus.COMPLETED);
      expect(updated.escrowStatus).toBe(EscrowStatus.RELEASED);
      expect(updated.completedAt).toBeInstanceOf(Date);
      expect(updated.autoCompleteAt).toBeNull();

      // Инвариант комиссий: fee + referral + net === amount
      expect(
        round2(result.platformFee + result.referralBonus + result.sellerNet),
      ).toBe(1000);
    });

    it('идемпотентен: двойной релиз не удваивает баланс', async () => {
      const buyer = await mkUser('rel2-buyer');
      const seller = await mkUser('rel2-seller');
      const order = await mkOrder({
        buyerId: buyer.id,
        sellerId: seller.id,
        amount: 300,
        platformFee: 30,
      });

      await escrow.holdForOrder(order.id);
      const first = await escrow.releaseEscrow(order.id);
      const second = await escrow.releaseEscrow(order.id);

      expect(first.released).toBe(true);
      expect(second.released).toBe(false);
      expect(await sumFor(seller.id, LedgerAccount.AVAILABLE)).toBe(270);

      const entries = await prisma.ledgerEntry.findMany({
        where: { orderId: order.id, type: 'escrow_release' },
      });
      // ESCROW + AVAILABLE = 2 проводки, ровно один релиз.
      expect(entries).toHaveLength(2);
    });

    it('гонка: buyer confirm + cron одновременно — один релиз', async () => {
      const buyer = await mkUser('relrace-buyer');
      const seller = await mkUser('relrace-seller');
      const order = await mkOrder({
        buyerId: buyer.id,
        sellerId: seller.id,
        amount: 200,
        platformFee: 20,
      });

      await escrow.holdForOrder(order.id);

      const results = await Promise.all([
        escrow.releaseEscrow(order.id, 'buyer_confirmed'),
        escrow.releaseEscrow(order.id, 'auto_timeout'),
      ]);

      expect(results.filter((r) => r.released)).toHaveLength(1);
      expect(await sumFor(seller.id, LedgerAccount.AVAILABLE)).toBe(180);

      const updated = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(updated.escrowStatus).toBe(EscrowStatus.RELEASED);
    });

    it('релиз без холда — no-op (эскроу не создан)', async () => {
      const buyer = await mkUser('relnohold-buyer');
      const seller = await mkUser('relnohold-seller');
      const order = await mkOrder({
        buyerId: buyer.id,
        sellerId: seller.id,
        amount: 100,
      });

      const result = await escrow.releaseEscrow(order.id);
      expect(result.released).toBe(false);
      expect(await sumFor(seller.id, LedgerAccount.AVAILABLE)).toBe(0);
    });
  });

  // ============================================================
  // Возврат и SPLIT (§5.1, §5.3)
  // ============================================================

  describe('refundEscrow', () => {
    it('полный возврат: покупатель получает всё, эскроу REFUNDED', async () => {
      const buyer = await mkUser('ref-buyer');
      const seller = await mkUser('ref-seller');
      const order = await mkOrder({
        buyerId: buyer.id,
        sellerId: seller.id,
        amount: 1000,
        platformFee: 100,
      });

      await escrow.holdForOrder(order.id);
      const result = await escrow.refundEscrow(
        order.id,
        'seller_no_ship_timeout',
        100,
      );

      expect(result.refunded).toBe(true);
      expect(result.toBuyer).toBe(1000);
      expect(result.toSeller).toBe(0);
      expect(result.feeCut).toBe(0);

      expect(await sumFor(buyer.id, LedgerAccount.AVAILABLE)).toBe(1000);
      expect(await sumFor(buyer.id, LedgerAccount.ESCROW)).toBe(0);
      expect(await sumFor(seller.id, LedgerAccount.AVAILABLE)).toBe(0);

      const updated = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(updated.status).toBe(OrderStatus.REFUNDED);
      expect(updated.escrowStatus).toBe(EscrowStatus.REFUNDED);
      expect(updated.cancelReason).toBe('seller_no_ship_timeout');
      expect(updated.autoCompleteAt).toBeNull();
    });

    it('SPLIT 60: покупатель 600, продавец 360, платформа 40', async () => {
      const buyer = await mkUser('split-buyer');
      const seller = await mkUser('split-seller');
      const order = await mkOrder({
        buyerId: buyer.id,
        sellerId: seller.id,
        amount: 1000,
        platformFee: 100,
      });

      await escrow.holdForOrder(order.id);
      const result = await escrow.refundEscrow(
        order.id,
        'arbitration_split',
        60,
      );

      expect(result.refunded).toBe(true);
      expect(result.toBuyer).toBe(600);
      expect(result.toSeller).toBe(360);
      expect(result.feeCut).toBe(40);

      // Сумма частей сходится с эскроу — деньги не потеряны.
      expect(
        escrowSplitInvariant(1000, {
          toBuyer: result.toBuyer,
          toSeller: result.toSeller,
          feeCut: result.feeCut,
        }),
      ).toBe(true);

      expect(await sumFor(buyer.id, LedgerAccount.AVAILABLE)).toBe(600);
      expect(await sumFor(seller.id, LedgerAccount.AVAILABLE)).toBe(360);

      const platform = await prisma.ledgerEntry.aggregate({
        where: { orderId: order.id, account: LedgerAccount.PLATFORM },
        _sum: { amount: true },
      });
      expect(round2(platform._sum.amount ?? 0)).toBe(40);

      const updated = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(updated.escrowStatus).toBe(EscrowStatus.SPLIT);
      expect(updated.status).toBe(OrderStatus.REFUNDED);
    });

    it('идемпотентен: двойной возврат не удваивает баланс', async () => {
      const buyer = await mkUser('ref2-buyer');
      const seller = await mkUser('ref2-seller');
      const order = await mkOrder({
        buyerId: buyer.id,
        sellerId: seller.id,
        amount: 500,
      });

      await escrow.holdForOrder(order.id);
      const first = await escrow.refundEscrow(order.id, 'admin_refund', 100);
      const second = await escrow.refundEscrow(order.id, 'admin_refund', 100);

      expect(first.refunded).toBe(true);
      expect(second.refunded).toBe(false);
      expect(await sumFor(buyer.id, LedgerAccount.AVAILABLE)).toBe(500);
    });

    it('гонка refund/release — побеждает ровно один', async () => {
      const buyer = await mkUser('mixrace-buyer');
      const seller = await mkUser('mixrace-seller');
      const order = await mkOrder({
        buyerId: buyer.id,
        sellerId: seller.id,
        amount: 400,
        platformFee: 40,
      });

      await escrow.holdForOrder(order.id);

      const [refund, release] = await Promise.all([
        escrow.refundEscrow(order.id, 'arbitration_buyer_right', 100),
        escrow.releaseEscrow(order.id, 'arbitration'),
      ]);

      expect([refund.refunded, release.released].filter(Boolean)).toHaveLength(
        1,
      );

      const updated = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
      });
      // Деньги ушли ровно в одну сторону.
      if (refund.refunded) {
        expect(await sumFor(buyer.id, LedgerAccount.AVAILABLE)).toBe(400);
        expect(await sumFor(seller.id, LedgerAccount.AVAILABLE)).toBe(0);
        expect(updated.escrowStatus).toBe(EscrowStatus.REFUNDED);
      } else {
        expect(await sumFor(seller.id, LedgerAccount.AVAILABLE)).toBe(360);
        expect(await sumFor(buyer.id, LedgerAccount.AVAILABLE)).toBe(0);
        expect(updated.escrowStatus).toBe(EscrowStatus.RELEASED);
      }
      expect(await sumFor(buyer.id, LedgerAccount.ESCROW)).toBe(0);
    });

    it('нулевой эскроу — no-op, а не падение', async () => {
      const buyer = await mkUser('refzero-buyer');
      const seller = await mkUser('refzero-seller');
      const order = await mkOrder({
        buyerId: buyer.id,
        sellerId: seller.id,
        amount: 0,
      });

      const result = await escrow.refundEscrow(order.id, 'admin_refund', 100);
      expect(result.refunded).toBe(false);
    });
  });

  // ============================================================
  // Агрегаты для UI (§4.6)
  // ============================================================

  describe('getSellerPendingEscrow', () => {
    it('считает замороженное по заказам продавца', async () => {
      const buyer = await mkUser('agg-buyer');
      const seller = await mkUser('agg-seller');

      const o1 = await mkOrder({
        buyerId: buyer.id,
        sellerId: seller.id,
        amount: 300,
      });
      const o2 = await mkOrder({
        buyerId: buyer.id,
        sellerId: seller.id,
        amount: 700,
      });

      await escrow.holdForOrder(o1.id);
      await escrow.holdForOrder(o2.id);
      await escrow.releaseEscrow(o2.id, 'buyer_confirmed');

      const pending = await escrow.getSellerPendingEscrow(seller.id);
      expect(pending).toBe(300);

      const balances = await ledger.getBalances(seller.id);
      expect(balances.pendingEscrow).toBe(300);

      const orders = await escrow.getSellerEscrowOrders(seller.id);
      expect(orders.map((o) => o.id)).toEqual([o1.id]);
    });
  });
});
