/**
 * Интеграционные тесты LedgerService против реальной БД (§8.1 ТЗ).
 *
 * Проверяют главное свойство денежного контура: идемпотентность по refKey
 * и сходимость балансов с журналом. Мокать Prisma здесь бессмысленно —
 * вся защита построена на unique-констрейнте и агрегатах Postgres.
 */
import { EscrowStatus, LedgerAccount } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { cleanupTestData } from '../common/prisma/test-db-cleanup';
import { LedgerService } from './ledger.service';
import { LedgerInvariantError } from './dto/ledger.dto';
import { addDays, addMinutes, fromRaw, round2, toRaw } from './money.util';

describe('LedgerService (integration)', () => {
  const prisma = new PrismaService();
  const notifications = {
    // Пишем в реальную таблицу Notification — тест проверяет, что запись
    // реально видна в /notifications, а не только «метод вызван».
    createNotification: jest.fn(
      async (userId: string, type: string, message: string, relatedId?: string) =>
        prisma.notification.create({ data: { userId, type, message, relatedId } }),
    ),
    sendToUser: jest.fn().mockResolvedValue(null),
  } as any;
  const ledger = new LedgerService(prisma, notifications);

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const createdUserIds: string[] = [];
  const createdOrderIds: string[] = [];

  /** phone-префиксы — namespace ровно этой спеки (см. test-db-cleanup.ts). */
  const TEST_PREFIXES = ['ledger-test-', 'ledger-admin'];

  const mkUser = async (name: string) => {
    const user = await prisma.user.create({
      data: {
        phone: `ledger-test-${name}-${suffix}`,
        name: `Ledger Test ${name}`,
        referralCode: `lt-${name}-${suffix}`,
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
    escrowStatus?: EscrowStatus;
    escrowAmount?: number;
  }) => {
    const order = await prisma.order.create({
      data: {
        buyerId: params.buyerId,
        sellerId: params.sellerId,
        amount: params.amount,
        platformFee: params.platformFee ?? 0,
        referralBonus: params.referralBonus ?? 0,
        referralUserId: params.referralUserId ?? null,
        status: 'PENDING',
        escrowStatus: params.escrowStatus ?? EscrowStatus.NONE,
        escrowAmount: params.escrowAmount ?? 0,
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
    // Полная уборка (W1 §2): не только свои id, но и всё, что тест мог
    // породить в связанных таблицах (Notification от алерт-тестов, AuditLog,
    // Deal/BazarMessage/... ), плюс мусор прошлых прогонов этого namespace.
    // Раньше уведомления удалялись только по createdUserIds, а PLATFORM-
    // проводки без userId/orderId оставались висеть между прогонами.
    await cleanupTestData(
      prisma,
      {
        userIds: createdUserIds,
        orderIds: createdOrderIds,
      },
      {
        prefixes: TEST_PREFIXES,
        // PLATFORM-проводки батча `test-batch-b` идут без userId/orderId —
        // их ловим по refKey, куда зашит suffix прогона.
        refKeyContains: suffix,
      },
    );
    await prisma.$disconnect();
  });

  // ============================================================
  // money.util — BigInt-математика (§6.3)
  // ============================================================

  describe('money.util', () => {
    it('toRaw/fromRaw round-trip для 18 decimals', () => {
      expect(toRaw(1000, 18)).toBe('1000000000000000000000');
      expect(fromRaw('1000000000000000000000', 18)).toBe(1000);
      expect(fromRaw(toRaw(0.01, 18), 18)).toBeCloseTo(0.01, 6);
    });

    it('toRaw/fromRaw round-trip для 6 decimals (USDC)', () => {
      expect(toRaw(1, 6)).toBe('1000000');
      expect(fromRaw('1000000', 6)).toBe(1);
      expect(fromRaw(toRaw(123.456789, 6), 6)).toBeCloseTo(123.456789, 5);
    });

    it('не теряет точность на больших суммах', () => {
      // 9_000_000 USDT — выше порога Number safe integer в атомарных единицах.
      const raw = toRaw(9_000_000, 18);
      expect(raw).toBe('9000000000000000000000000');
      expect(fromRaw(raw, 18)).toBe(9_000_000);
    });

    it('round2 округляет деньги до копеек', () => {
      expect(round2(0.1 + 0.2)).toBe(0.3);
      expect(round2(849.999)).toBe(850);
      expect(round2(100.005)).toBe(100.01);
    });

    it('addDays/addMinutes иммутабельны', () => {
      const base = new Date('2026-09-11T10:00:00.000Z');
      const plus5 = addDays(base, 5);
      const plus15 = addMinutes(base, 15);
      expect(base.toISOString()).toBe('2026-09-11T10:00:00.000Z');
      expect(plus5.getTime() - base.getTime()).toBe(5 * 86400000);
      expect(plus15.getTime() - base.getTime()).toBe(15 * 60000);
    });

    it('fromRaw терпим к null/пустой строке', () => {
      expect(fromRaw(null, 18)).toBe(0);
      expect(fromRaw('', 18)).toBe(0);
      expect(fromRaw(undefined, 18)).toBe(0);
    });
  });

  // ============================================================
  // Идемпотентность
  // ============================================================

  describe('идемпотентность по refKey', () => {
    it('двойной hold() не дублирует проводку и не меняет баланс', async () => {
      const buyer = await mkUser('idem-buyer');
      const order = await mkOrder({
        buyerId: buyer.id,
        sellerId: (await mkUser('idem-seller')).id,
        amount: 1000,
      });

      const first = await ledger.hold(null, {
        orderId: order.id,
        userId: buyer.id,
        amount: 1000,
      });
      const second = await ledger.hold(null, {
        orderId: order.id,
        userId: buyer.id,
        amount: 1000,
      });

      expect(first.applied).toEqual([`escrow_hold:order:${order.id}`]);
      expect(first.skipped).toEqual([]);
      expect(second.applied).toEqual([]);
      expect(second.skipped).toEqual([`escrow_hold:order:${order.id}`]);

      const rows = await prisma.ledgerEntry.findMany({
        where: { orderId: order.id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].amount).toBe(1000);
      expect(rows[0].account).toBe(LedgerAccount.ESCROW);
    });

    it('повторный apply того же батча — no-op', async () => {
      const user = await mkUser('idem-batch');
      const ops = [
        {
          account: LedgerAccount.AVAILABLE,
          amount: 500,
          type: 'escrow_release',
          refKey: `test-batch-a:${suffix}`,
          userId: user.id,
        },
        {
          account: LedgerAccount.PLATFORM,
          amount: -500,
          type: 'platform_fee',
          refKey: `test-batch-b:${suffix}`,
          userId: null,
        },
      ];

      const first = await ledger.apply(null, ops, { assertZeroSum: true });
      const second = await ledger.apply(null, ops, { assertZeroSum: true });

      expect(first.applied).toHaveLength(2);
      expect(second.applied).toHaveLength(0);
      expect(second.skipped).toHaveLength(2);
      expect(await sumFor(user.id, LedgerAccount.AVAILABLE)).toBe(500);
    });

    it('два одновременных hold() — ровно одна запись', async () => {
      const buyer = await mkUser('race-buyer');
      const order = await mkOrder({
        buyerId: buyer.id,
        sellerId: (await mkUser('race-seller')).id,
        amount: 777,
      });

      const results = await Promise.allSettled([
        ledger.hold(null, { orderId: order.id, userId: buyer.id, amount: 777 }),
        ledger.hold(null, { orderId: order.id, userId: buyer.id, amount: 777 }),
      ]);

      const rows = await prisma.ledgerEntry.findMany({
        where: { orderId: order.id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].amount).toBe(777);
      // Обе операции должны завершиться без исключений (вторая — skip).
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(0);
    });
  });

  // ============================================================
  // Валидация и инварианты
  // ============================================================

  describe('валидация', () => {
    it('батч с ненулевой суммой при assertZeroSum падает', async () => {
      await expect(
        ledger.apply(
          null,
          [
            {
              account: LedgerAccount.AVAILABLE,
              amount: 100,
              type: 'escrow_release',
              refKey: `unbalanced:${suffix}`,
              userId: null,
            },
          ],
          { assertZeroSum: true },
        ),
      ).rejects.toThrow(LedgerInvariantError);
    });

    it('AVAILABLE без userId отклоняется', async () => {
      await expect(
        ledger.apply(null, [
          {
            account: LedgerAccount.AVAILABLE,
            amount: 100,
            type: 'escrow_release',
            refKey: `no-user:${suffix}`,
            userId: null,
          },
        ]),
      ).rejects.toThrow(/requires userId/);
    });

    it('дубликат refKey внутри батча отклоняется', async () => {
      const key = `dup:${suffix}`;
      await expect(
        ledger.apply(null, [
          {
            account: LedgerAccount.PLATFORM,
            amount: -10,
            type: 'escrow_release',
            refKey: key,
            userId: null,
          },
          {
            account: LedgerAccount.PLATFORM,
            amount: -10,
            type: 'platform_fee',
            refKey: key,
            userId: null,
          },
        ]),
      ).rejects.toThrow(/duplicate refKey/);
    });

    it('hold() с неположительной суммой отклоняется', async () => {
      await expect(
        ledger.hold(null, { orderId: 'x', userId: 'y', amount: 0 }),
      ).rejects.toThrow(/amount must be > 0/);
    });
  });

  // ============================================================
  // release / refund
  // ============================================================

  describe('release', () => {
    it('распределяет эскроу и держит нулевую сумму батча', async () => {
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

      await ledger.hold(null, {
        orderId: order.id,
        userId: buyer.id,
        amount: 1000,
      });

      const result = await ledger.release(null, {
        orderId: order.id,
        buyerId: buyer.id,
        sellerId: seller.id,
        amount: 1000,
        platformFee: 100,
        sellerNet: 850,
        referralUserId: referrer.id,
        referralBonus: 50,
      });

      expect(result.applied).toHaveLength(4);
      expect(await sumFor(seller.id, LedgerAccount.AVAILABLE)).toBe(850);
      expect(await sumFor(referrer.id, LedgerAccount.REFERRAL)).toBe(50);
      expect(await sumFor(buyer.id, LedgerAccount.ESCROW)).toBe(0);

      const platform = await prisma.ledgerEntry.aggregate({
        where: { orderId: order.id, account: LedgerAccount.PLATFORM },
        _sum: { amount: true },
      });
      expect(round2(platform._sum.amount ?? 0)).toBe(100);
    });
  });

  describe('refund / split', () => {
    it('полный возврат: эскроу обнуляется, покупатель получает всё', async () => {
      const buyer = await mkUser('ref-buyer');
      const seller = await mkUser('ref-seller');
      const order = await mkOrder({
        buyerId: buyer.id,
        sellerId: seller.id,
        amount: 1000,
        platformFee: 100,
      });

      await ledger.hold(null, {
        orderId: order.id,
        userId: buyer.id,
        amount: 1000,
      });
      await ledger.refund(null, {
        orderId: order.id,
        buyerId: buyer.id,
        sellerId: seller.id,
        amount: 1000,
        toBuyer: 1000,
      });

      expect(await sumFor(buyer.id, LedgerAccount.AVAILABLE)).toBe(1000);
      expect(await sumFor(buyer.id, LedgerAccount.ESCROW)).toBe(0);
      expect(await sumFor(seller.id, LedgerAccount.AVAILABLE)).toBe(0);
    });

    it('SPLIT 60/40: покупатель 600, продавец 300, платформа 40', async () => {
      const buyer = await mkUser('split-buyer');
      const seller = await mkUser('split-seller');
      const order = await mkOrder({
        buyerId: buyer.id,
        sellerId: seller.id,
        amount: 1000,
        platformFee: 100,
      });

      await ledger.hold(null, {
        orderId: order.id,
        userId: buyer.id,
        amount: 1000,
      });

      // pct=60 -> toBuyer=600, feeCut=100*0.4=40, toSeller=1000-600-40=360
      const result = await ledger.refund(null, {
        orderId: order.id,
        buyerId: buyer.id,
        sellerId: seller.id,
        amount: 1000,
        toBuyer: 600,
        toSeller: 360,
        feeCut: 40,
      });

      expect(result.applied).toHaveLength(4);
      expect(await sumFor(buyer.id, LedgerAccount.AVAILABLE)).toBe(600);
      expect(await sumFor(seller.id, LedgerAccount.AVAILABLE)).toBe(360);
      expect(await sumFor(buyer.id, LedgerAccount.ESCROW)).toBe(0);

      const platform = await prisma.ledgerEntry.aggregate({
        where: { orderId: order.id, account: LedgerAccount.PLATFORM },
        _sum: { amount: true },
      });
      expect(round2(platform._sum.amount ?? 0)).toBe(40);
    });
  });

  // ============================================================
  // Балансы и инварианты
  // ============================================================

  describe('getBalances / verifyInvariants', () => {
    it('баланс в журнале == кэш на User (availableBalance)', async () => {
      const buyer = await mkUser('bal-buyer');
      const seller = await mkUser('bal-seller');
      const order = await mkOrder({
        buyerId: buyer.id,
        sellerId: seller.id,
        amount: 400,
        platformFee: 40,
      });

      await ledger.hold(null, {
        orderId: order.id,
        userId: buyer.id,
        amount: 400,
      });
      await ledger.release(null, {
        orderId: order.id,
        buyerId: buyer.id,
        sellerId: seller.id,
        amount: 400,
        platformFee: 40,
        sellerNet: 360,
      });

      const balances = await ledger.getBalances(seller.id);
      expect(balances.availableBalance).toBe(360);
      expect(balances.totalWithdrawable).toBe(360);

      const dbSeller = await prisma.user.findUniqueOrThrow({
        where: { id: seller.id },
      });
      expect(round2(dbSeller.availableBalance)).toBe(360);

      // balanceAfter проставлен для пользовательских проводок.
      const entry = await prisma.ledgerEntry.findFirst({
        where: { userId: seller.id, account: LedgerAccount.AVAILABLE },
      });
      expect(entry).not.toBeNull();
      expect(round2(entry!.balanceAfter ?? -1)).toBe(360);
    });

    it('verifyInvariants не находит проблем после корректных операций', async () => {
      const buyer = await mkUser('inv-buyer');
      const seller = await mkUser('inv-seller');
      const order = await mkOrder({
        buyerId: buyer.id,
        sellerId: seller.id,
        amount: 250,
        platformFee: 25,
      });

      await ledger.hold(null, {
        orderId: order.id,
        userId: buyer.id,
        amount: 250,
      });
      await prisma.order.update({
        where: { id: order.id },
        data: { escrowStatus: 'HELD', escrowAmount: 250 },
      });

      const report = await ledger.verifyInvariants();

      // Глобальных нарушений по нашим операциям быть не должно.
      // (report.ok глобально может быть false из-за посторонних данных —
      // на проде это как раз то, что ловит алерт.)
      const ownProblems = report.problems.filter(
        (p) => p.includes(order.id) || p.includes(seller.id),
      );
      expect(ownProblems).toEqual([]);
      expect(report.totals.escrow).toBeGreaterThanOrEqual(250);
    });

    it('verifyInvariants ловит расхождение журнала и кэша баланса', async () => {
      const seller = await mkUser('drift-seller');
      await ledger.credit(null, {
        userId: seller.id,
        account: LedgerAccount.AVAILABLE,
        amount: 100,
        type: 'deposit_overpay',
        refKey: `drift:${suffix}`,
      });

      // Портим кэш руками — ровно то, что должно ловиться алертом.
      await prisma.user.update({
        where: { id: seller.id },
        data: { availableBalance: 999 },
      });

      const report = await ledger.verifyInvariants();
      expect(report.ok).toBe(false);
      expect(
        report.problems.some(
          (p) => p.includes(seller.id) && p.includes('availableBalance'),
        ),
      ).toBe(true);
    });

    it('алерт админам: расхождение инвариантов создаёт Notification для ADMIN', async () => {
      // Админ-пользователь — цель алерта.
      const admin = await prisma.user.create({
        data: {
          phone: `ledger-admin-${suffix}`,
          name: 'Ledger Admin',
          referralCode: `lt-admin-${suffix}`,
          role: 'ADMIN',
        },
      });
      createdUserIds.push(admin.id);

      // Ломаем кэш баланса, чтобы инвариант (1) гарантированно сработал.
      const broken = await mkUser('alert-broken');
      await ledger.credit(null, {
        userId: broken.id,
        account: LedgerAccount.AVAILABLE,
        amount: 50,
        type: 'deposit_overpay',
        refKey: `alert-credit:${suffix}`,
      });
      await prisma.user.update({
        where: { id: broken.id },
        data: { availableBalance: 12345 },
      });

      notifications.createNotification.mockClear();

      // Флак-фикс (W1 §1). Первый прогон в этом тесте создаёт алерт с полным
      // списком нарушений, в том числе по нашему `broken`. Но дедуп в
      // notifyAdminsSafely() держится на СТРОКЕ сообщения (type+message за час),
      // а сообщение truncate'ится до первых 5 нарушений. Стоит рядом оказаться
      // чужому нарушению с тем же текстом (а на грязной БД их десятки: мусор
      // прошлых прогонов) — дедуп решает «уже отправляли» и НЕ создаёт
      // Notification вообще, после чего mock.calls пуст и тест падает.
      //
      // Поэтому: (1) чистим денежные алерты этого админа, чтобы дедуп не
      // сработал от записи предыдущего теста/прогона; (2) саму проверку делаем
      // по списку проблем, а не по обрезанному тексту уведомления — так тест не
      // зависит ни от порядка проблем, ни от truncate'а до 5 строк.
      await prisma.notification.deleteMany({
        where: { userId: admin.id, type: { in: ['money_alert', 'money_warning'] } },
      });

      const report = await ledger.verifyInvariants();
      expect(report.ok).toBe(false);
      const brokenProblem = report.problems.find(
        (p) => p.includes(broken.id) && p.includes('availableBalance'),
      );
      expect(brokenProblem).toBeDefined();

      const res = await ledger.runInvariantCheck();
      expect(res.ok).toBe(false);

      // Алерт реально доставлен: createNotification вызван для админа
      // с типом money_alert и текстом, содержащим нарушение.
      const calls = notifications.createNotification.mock.calls;
      const adminCall = calls.find((c: any[]) => c[0] === admin.id);
      expect(adminCall).toBeDefined();
      expect(adminCall[1]).toBe('money_alert');
      expect(String(adminCall[2])).toContain('Нарушения инвариантов');

      // И запись видна в /notifications (та же таблица). Берём СВЕЖУЮ запись
      // этого прогона: findFirst без сортировки вернул бы любую старую
      // money_alert этого админа.
      const stored = await prisma.notification.findFirst({
        where: { userId: admin.id, type: 'money_alert' },
        orderBy: { createdAt: 'desc' },
      });
      expect(stored).not.toBeNull();
      // Уведомление обрезано до первых 5 нарушений (alertAdmins), поэтому
      // требовать именно broken.id нельзя — он может не попасть в топ-5 на
      // грязной БД. Проверяем свойство посильнее и детерминированно: текст
      // алерта обязан описывать ТЕКУЩИЙ набор нарушений, т.е. хотя бы одна
      // проблема из отчёта этого прогона дословно присутствует в сообщении.
      // Именно это и ломалось: глобальный дедуп глушил доставку, и в
      // /notifications лежал алерт от прошлого инцидента.
      const currentInMessage = report.problems.filter((p) =>
        stored!.message.includes(p),
      );
      expect(currentInMessage.length).toBeGreaterThan(0);
    });

    it('алерт: расхождение реестра эскроу (статус без проводок)', async () => {
      const admin = await prisma.user.create({
        data: {
          phone: `ledger-admin2-${suffix}`,
          name: 'Ledger Admin 2',
          referralCode: `lt-admin2-${suffix}`,
          role: 'ADMIN',
        },
      });
      createdUserIds.push(admin.id);

      const buyer = await mkUser('esc-buyer');
      const seller = await mkUser('esc-seller');
      // Заказ помечен HELD, но проводок ESCROW по нему нет → mismatch.
      const order = await mkOrder({
        buyerId: buyer.id,
        sellerId: seller.id,
        amount: 777,
        escrowStatus: EscrowStatus.HELD,
        escrowAmount: 777,
      });

      notifications.createNotification.mockClear();
      await ledger.runInvariantCheck();

      const calls = notifications.createNotification.mock.calls;
      const adminCall = calls.find((c: any[]) => c[0] === admin.id);
      expect(adminCall).toBeDefined();
      expect(String(adminCall[2])).toContain(order.id);
    });

    it('сиротский депозит зачисляется на AVAILABLE покупателя', async () => {
      const buyer = await mkUser('orphan-buyer');
      const seller = await mkUser('orphan-seller');
      const order = await mkOrder({
        buyerId: buyer.id,
        sellerId: seller.id,
        amount: 300,
      });

      const result = await ledger.credit(null, {
        userId: buyer.id,
        account: LedgerAccount.AVAILABLE,
        amount: 300,
        type: 'orphan_deposit',
        refKey: `orphan_deposit:tx:0xdeadbeef-${suffix}`,
        orderId: order.id,
      });

      expect(result.applied).toHaveLength(1);
      expect(await sumFor(buyer.id, LedgerAccount.AVAILABLE)).toBe(300);
    });
  });

  describe('getHistory', () => {
    it('возвращает пагинированную историю пользователя', async () => {
      const user = await mkUser('hist-user');
      const order = await mkOrder({
        buyerId: user.id,
        sellerId: (await mkUser('hist-seller')).id,
        amount: 100,
      });

      await ledger.hold(null, {
        orderId: order.id,
        userId: user.id,
        amount: 100,
      });
      await ledger.credit(null, {
        userId: user.id,
        account: LedgerAccount.AVAILABLE,
        amount: 20,
        type: 'deposit_overpay',
        refKey: `hist-overpay:${suffix}`,
      });

      const history = await ledger.getHistory(user.id, { page: 1, limit: 10 });
      expect(history.total).toBe(2);
      expect(history.items.length).toBe(2);
      expect(history.pages).toBe(1);

      const escrowOnly = await ledger.getHistory(user.id, {
        account: LedgerAccount.ESCROW,
      });
      expect(escrowOnly.total).toBe(1);
    });
  });

  // ============================================================
  // D8 — updateBalanceCache не затирает легаси bonusBalance
  // ============================================================
  describe('D8: легаси bonusBalance не обнуляется', () => {
    it('сид-бонус сохраняется при начислении реферального бонуса', async () => {
      const referrer = await mkUser('d8-referrer');
      const buyer = await mkUser('d8-buyer');
      const seller = await mkUser('d8-seller');

      // Легаси-сид: бонус выдан до введения LedgerEntry (журнала нет).
      await prisma.user.update({
        where: { id: referrer.id },
        data: { bonusBalance: 500 },
      });

      // Любая ledger-операция у этого пользователя: реферальный бонус +50.
      const order = await mkOrder({
        buyerId: buyer.id,
        sellerId: seller.id,
        amount: 1000,
        platformFee: 100,
        referralBonus: 50,
        referralUserId: referrer.id,
      });

      await ledger.hold(null, {
        orderId: order.id,
        userId: buyer.id,
        amount: 1000,
      });
      await ledger.release(null, {
        orderId: order.id,
        buyerId: buyer.id,
        sellerId: seller.id,
        amount: 1000,
        platformFee: 100,
        sellerNet: 850,
        referralUserId: referrer.id,
        referralBonus: 50,
      });

      const fresh = await prisma.user.findUniqueOrThrow({
        where: { id: referrer.id },
      });
      // Сид 500 НЕ обнулён и НЕ перезаписан на 50: 500 + 50 = 550.
      expect(round2(fresh.bonusBalance)).toBe(550);

      // Журнал при этом содержит только 50 — расхождение с кэшем объяснимо
      // легаси-сидом и допускается как warning.
      expect(await sumFor(referrer.id, LedgerAccount.REFERRAL)).toBe(50);
    });
  });
});