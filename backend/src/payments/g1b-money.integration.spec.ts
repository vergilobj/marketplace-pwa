/**
 * G1b ФИКС 3 + ФИКС 4 (integration, РЕАЛЬНАЯ БД).
 *
 * ФИКС 3 — `LedgerEntry` строго append-only.
 *   Было: `updateBalanceCache` после вставки батча делал
 *   `ledgerEntry.update({ data: { balanceAfter } })` — переписывал УЖЕ
 *   записанные строки журнала. Причём всем проводкам батча выставлял ОДНО И
 *   ТО ЖЕ значение (итоговый баланс пользователя), а не баланс на момент
 *   проводки.
 *   Стало: `balanceAfter` считается ДО вставки (projectBalances) и пишется в
 *   `create`. Строка журнала после создания не меняется НИКОГДА.
 *   Проверяем оба следствия: running-баланс внутри батча + неизменность
 *   старых строк при последующих операциях.
 *
 * ФИКС 4 — пропуск проводки по дублю refKey в escrow больше не «тихий успех».
 *   `LedgerService.apply({idempotent:true})` использует
 *   `createMany({ skipDuplicates: true })`: коллизия refKey молча съедается.
 *   Если при этом состояние заказа уже переведено (escrowStatus=RELEASED,
 *   деньги списаны с эскроу), получается «эскроу закрыт, проводок нет» —
 *   потеря или минт денег. Теперь `escrow.assertLedgerApplied` кидает
 *   LedgerInvariantError, транзакция откатывается, заказ остаётся в HELD.
 *   Легитимный повтор (тот же вызов второй раз) при этом остаётся no-op —
 *   он до записи не доходит по гарду `updateMany({ escrowStatus: HELD })`,
 *   поэтому проверяем и это: повторный releaseEscrow не кидает.
 */
import {
  EscrowStatus,
  LedgerAccount,
  OrderStatus,
} from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { cleanupTestData } from '../common/prisma/test-db-cleanup';
import { LedgerService } from './ledger.service';
import { LedgerInvariantError } from './dto/ledger.dto';
import { EscrowService } from './escrow.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('G1b (integration): append-only журнал и guard проводок эскроу', () => {
  const prisma = new PrismaService();

  const notify = {
    createNotification: jest.fn().mockResolvedValue(null),
    sendToUser: jest.fn().mockResolvedValue(null),
  } as unknown as NotificationsService;

  const ledger = new LedgerService(prisma, notify);
  const settings = new SettingsService(prisma);
  const escrow = new EscrowService(prisma, ledger, settings, notify);

  const suffix = `g1b-money-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const userIds: string[] = [];
  const orderIds: string[] = [];

  const mkUser = async (name: string, bonusBalance = 0) => {
    const user = await prisma.user.create({
      data: {
        phone: `${suffix}-${name}`,
        name: `G1b ${name}`,
        role: 'SELLER',
        referralCode: `${suffix}-${name}`,
        bonusBalance,
      },
    });
    userIds.push(user.id);
    return user;
  };

  const entry = (refKey: string) =>
    prisma.ledgerEntry.findUniqueOrThrow({ where: { refKey } });

  beforeAll(async () => {
    await prisma.$connect();
    await settings.set('escrow_ship_deadline_days', '5');
    await settings.set('escrow_autocomplete_days', '7');
  });

  afterAll(async () => {
    await cleanupTestData(
      prisma,
      { userIds, orderIds },
      { prefixes: ['g1b-money-'], refKeyContains: suffix },
    );
    await prisma.$disconnect();
  });

  // ============================================================
  // ФИКС 3
  // ============================================================

  describe('ФИКС 3: LedgerEntry append-only, balanceAfter пишется при create', () => {
    it('running-баланс внутри батча: каждая проводка видит свой баланс', async () => {
      const user = await mkUser('running');

      await ledger.apply(
        null,
        [
          {
            account: LedgerAccount.AVAILABLE,
            amount: 100,
            type: 'test_credit',
            refKey: `${suffix}:run:1`,
            userId: user.id,
          },
          {
            account: LedgerAccount.AVAILABLE,
            amount: -30,
            type: 'test_debit',
            refKey: `${suffix}:run:2`,
            userId: user.id,
          },
        ],
        { assertZeroSum: false },
      );

      expect((await entry(`${suffix}:run:1`)).balanceAfter).toBe(100);
      expect((await entry(`${suffix}:run:2`)).balanceAfter).toBe(70);

      const after = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { availableBalance: true },
      });
      expect(after.availableBalance).toBe(70);
    });

    it('старые строки не переписываются при последующих операциях', async () => {
      const user = await mkUser('immutable');

      await ledger.apply(
        null,
        [
          {
            account: LedgerAccount.AVAILABLE,
            amount: 100,
            type: 'test_credit',
            refKey: `${suffix}:imm:1`,
            userId: user.id,
          },
          {
            account: LedgerAccount.AVAILABLE,
            amount: -30,
            type: 'test_debit',
            refKey: `${suffix}:imm:2`,
            userId: user.id,
          },
        ],
        { assertZeroSum: false },
      );

      // Старое поведение: после этой операции ОБЕ прежние строки получили бы
      // balanceAfter=75 (итоговый баланс батча), а не свои 100 / 70.
      await ledger.apply(
        null,
        [
          {
            account: LedgerAccount.AVAILABLE,
            amount: 5,
            type: 'test_credit',
            refKey: `${suffix}:imm:3`,
            userId: user.id,
          },
        ],
        { assertZeroSum: false },
      );

      expect((await entry(`${suffix}:imm:1`)).balanceAfter).toBe(100);
      expect((await entry(`${suffix}:imm:2`)).balanceAfter).toBe(70);
      expect((await entry(`${suffix}:imm:3`)).balanceAfter).toBe(75);

      const after = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { availableBalance: true },
      });
      expect(after.availableBalance).toBe(75);
    });

    it('REFERRAL считается от bonusBalance — легаси-сид не обнуляется', async () => {
      // Сид: 500 бонусов выдано до введения журнала → проводок по ним нет.
      const user = await mkUser('legacy-bonus', 500);

      await ledger.apply(
        null,
        [
          {
            account: LedgerAccount.REFERRAL,
            amount: 10,
            type: 'referral_bonus',
            refKey: `${suffix}:ref:1`,
            userId: user.id,
          },
        ],
        { assertZeroSum: false },
      );

      // balanceAfter = сид 500 + 10, а НЕ сумма журнала (10).
      expect((await entry(`${suffix}:ref:1`)).balanceAfter).toBe(510);

      const after = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { bonusBalance: true },
      });
      expect(after.bonusBalance).toBe(510);
    });

    it('идемпотентный повтор не переписывает журнал', async () => {
      const user = await mkUser('idem');

      const op = {
        account: LedgerAccount.AVAILABLE,
        amount: 40,
        type: 'test_credit',
        refKey: `${suffix}:idem:1`,
        userId: user.id,
      };

      const first = await ledger.apply(null, [op], { assertZeroSum: false });
      expect(first.applied).toEqual([`${suffix}:idem:1`]);
      expect(first.skipped).toEqual([]);

      const second = await ledger.apply(null, [op], { assertZeroSum: false });
      expect(second.applied).toEqual([]);
      expect(second.skipped).toEqual([`${suffix}:idem:1`]);

      expect((await entry(`${suffix}:idem:1`)).balanceAfter).toBe(40);
      expect(
        await prisma.ledgerEntry.count({ where: { refKey: `${suffix}:idem:1` } }),
      ).toBe(1);
      const after = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { availableBalance: true },
      });
      expect(after.availableBalance).toBe(40);
    });
  });

  // ============================================================
  // ФИКС 4
  // ============================================================

  describe('ФИКС 4: escrow не считает успехом неприменившуюся проводку', () => {
    const mkHeldOrder = async (amount = 100) => {
      const buyer = await mkUser(`buyer-${orderIds.length}`);
      const seller = await mkUser(`seller-${orderIds.length}`);
      const order = await prisma.order.create({
        data: {
          buyerId: buyer.id,
          sellerId: seller.id,
          amount,
          platformFee: 10,
          status: OrderStatus.PAID,
          escrowStatus: EscrowStatus.HELD,
          escrowAmount: amount,
          escrowHeldAt: new Date(),
          autoCompleteAt: new Date(Date.now() + 86_400_000),
        },
      });
      orderIds.push(order.id);
      // Проводка холда — как её пишет holdForOrder.
      await ledger.apply(
        null,
        [
          {
            account: LedgerAccount.ESCROW,
            amount,
            type: 'escrow_hold',
            refKey: `escrow_hold:order:${order.id}`,
            userId: buyer.id,
            orderId: order.id,
          },
        ],
        { assertZeroSum: false },
      );
      return order;
    };

    it('коллизия refKey: релиз падает, транзакция откатывается, заказ остаётся HELD', async () => {
      const order = await mkHeldOrder(100);

      // Занимаем refKey, который должен записать сам релиз, «чужим» ордером
      // (userId=null, orderId=null — как делают агрегатные проводки).
      await prisma.ledgerEntry.create({
        data: {
          account: LedgerAccount.ESCROW,
          amount: -100,
          type: 'escrow_release',
          refKey: `escrow_release:${order.id}:ESCROW`,
          userId: null,
          orderId: null,
          currency: 'USDT',
        },
      });

      await expect(escrow.releaseEscrow(order.id, 'buyer_confirmed')).rejects.toThrow(
        LedgerInvariantError,
      );

      // Транзакция откатилась: заказ НЕ закрыт.
      const after = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(after.escrowStatus).toBe(EscrowStatus.HELD);
      expect(after.status).toBe(OrderStatus.PAID);
      expect(after.escrowClosedAt).toBeNull();

      // Ни одной новой проводки релиза не появилось.
      expect(
        await prisma.ledgerEntry.count({
          where: { refKey: { startsWith: `escrow_release:${order.id}:` } },
        }),
      ).toBe(1);
    });

    it('легитимный повтор релиза — no-op, без исключения', async () => {
      const order = await mkHeldOrder(120);

      const first = await escrow.releaseEscrow(order.id, 'buyer_confirmed');
      expect(first.released).toBe(true);
      expect(first.sellerNet).toBe(110);

      const afterFirst = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(afterFirst.escrowStatus).toBe(EscrowStatus.RELEASED);
      expect(afterFirst.status).toBe(OrderStatus.COMPLETED);

      // Второй вызов: гард escrowStatus=HELD не проходит → пустой результат,
      // до записи проводок дело не доходит, ничего не бросается.
      const second = await escrow.releaseEscrow(order.id, 'buyer_confirmed');
      expect(second.released).toBe(false);
      expect(second.sellerNet).toBe(0);

      const entries = await prisma.ledgerEntry.findMany({
        where: { refKey: { startsWith: `escrow_release:${order.id}:` } },
      });
      expect(entries.length).toBe(3); // ESCROW, PLATFORM, AVAILABLE
      const escrowRow = entries.find(
        (e) => e.refKey === `escrow_release:${order.id}:ESCROW`,
      );
      expect(escrowRow?.amount).toBe(-120);
    });
  });
});