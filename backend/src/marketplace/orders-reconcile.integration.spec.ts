/**
 * G1b ФИКС 1 (integration, РЕАЛЬНАЯ БД) — reconciler «PAID/SHIPPED + NONE».
 *
 * Дыра: `processSuccessfulPayment` делает `PENDING → PAID`, а затем отдельным
 * шагом `holdForOrder`. Если процесс умер между шагами и компенсация в
 * PENDING не доехала, заказ остаётся `PAID + escrowStatus=NONE`. Его не
 * видит НИ ОДИН крон: `autoCloseOrders` фильтрует `escrowStatus: HELD`,
 * `cancelExpiredOrders` — `status: PENDING`. Заказ висит вечно.
 *
 * Проверяем ровно то, что требует ТЗ:
 *   1. dry-run по умолчанию (apply:false) НЕ мутирует ничего;
 *   2. случай (б) — подтверждённой Transaction нет → заказ возвращается в
 *      PENDING, `paidAt` обнуляется;
 *   3. случай (а) — есть Transaction CONFIRMED → холд досоздаётся, заказ
 *      уходит в HELD и получает LedgerEntry(ESCROW);
 *   4. идемпотентность — второй прогон не меняет ничего;
 *   5. настройка-рубильник `escrow_reconcile_legacy_apply` управляет режимом.
 *
 * Спека НЕ использует батч по всей таблице: она передаёт адресный
 * `orderIds` (см. опцию в reconcileUnheldEscrow). Иначе самый старый батч
 * (`take: 100`, `orderBy createdAt asc`) целиком состоит из боевых
 * легаси-заказов 01.08 — их трогать нельзя, да и до тестовых дело бы не
 * дошло. Тестовые заказы создаются с `createdAt: now`, то есть в общем
 * порядке они ПОСЛЕ 654 боевых.
 *
 * Namespace — phone-префикс `g1b-`; уборка через общий cleanupTestData.
 */
import { EscrowStatus, LedgerAccount, OrderStatus, TransactionStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { cleanupTestData } from '../common/prisma/test-db-cleanup';
import { AuditService } from '../common/audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LedgerService } from '../payments/ledger.service';
import { EscrowService } from '../payments/escrow.service';
import { PaymentsService } from '../payments/payments.service';
import { OrdersService, ESCROW_RECONCILE_APPLY_SETTING } from './orders.service';

describe('G1b (integration): reconcileUnheldEscrow — PAID/SHIPPED без холда', () => {
  const prisma = new PrismaService();

  const notify = {
    createNotification: jest.fn().mockResolvedValue(null),
    sendToUser: jest.fn().mockResolvedValue(null),
  } as unknown as NotificationsService;

  const ledger = new LedgerService(prisma, notify);
  const settings = new SettingsService(prisma);
  const audit = new AuditService(prisma);
  const escrow = new EscrowService(prisma, ledger, settings, notify);

  const payments = new PaymentsService(
    prisma,
    settings,
    { createPayment: jest.fn() } as any,
    { createPayment: jest.fn() } as any,
    { getTxStatus: jest.fn() } as any,
    ledger,
    notify,
    escrow,
    undefined as any,
  );

  const orders = new OrdersService(
    prisma,
    audit,
    payments,
    escrow,
    settings,
    notify,
  );

  const suffix = `g1b-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const userIds: string[] = [];
  const orderIds: string[] = [];
  const productIds: string[] = [];

  const mkUser = async (name: string, role: 'BUYER' | 'SELLER' | 'ADMIN') => {
    const user = await prisma.user.create({
      data: {
        phone: `${suffix}-${name}`,
        name: `G1b ${name}`,
        role,
        referralCode: `${suffix}-${name}`,
      },
    });
    userIds.push(user.id);
    return user;
  };

  /**
   * Заказ ровно в том состоянии, которое чинит reconciler:
   * `status ∈ {PAID, SHIPPED}`, `escrowStatus = NONE`, `escrowAmount = 0`,
   * без `autoCompleteAt` и без проводок.
   */
  const mkStuckOrder = async (
    buyerId: string,
    sellerId: string,
    productId: string,
    status: 'PAID' | 'SHIPPED',
    amount = 100,
  ) => {
    const order = await prisma.order.create({
      data: {
        buyerId,
        sellerId,
        productId,
        amount,
        status,
        paidAt: new Date(Date.now() - 60_000),
        escrowStatus: EscrowStatus.NONE,
        escrowAmount: 0,
        platformFee: 0,
        ...(status === OrderStatus.SHIPPED ? { shippedAt: new Date() } : {}),
      },
    });
    orderIds.push(order.id);
    return order;
  };

  const escrowEntries = (orderId: string) =>
    prisma.ledgerEntry.aggregate({
      where: { orderId, account: LedgerAccount.ESCROW },
      _sum: { amount: true },
    });

  let buyer: { id: string };
  let seller: { id: string };
  let product: { id: string };

  beforeAll(async () => {
    await prisma.$connect();
    await settings.set('escrow_ship_deadline_days', '5');
    await settings.set('escrow_autocomplete_days', '7');
    buyer = await mkUser('buyer', 'BUYER');
    seller = await mkUser('seller', 'SELLER');
    const p = await prisma.product.create({
      data: { title: `G1b товар ${suffix}`, price: 100, sellerId: seller.id },
    });
    productIds.push(p.id);
    product = p;
  });

  afterAll(async () => {
    // Рубильник мог остаться включённым — гасим ДО уборки, чтобы он не влиял
    // на другие спеки, гоняющиеся против той же БД.
    await prisma.setting.deleteMany({
      where: { key: ESCROW_RECONCILE_APPLY_SETTING },
    });
    await cleanupTestData(
      prisma,
      { userIds, orderIds, productIds },
      { prefixes: ['g1b-'], refKeyContains: suffix },
    );
    await prisma.$disconnect();
  });

  it('dry-run по умолчанию (apply:false): classify, но 0 мутаций', async () => {
    const o = await mkStuckOrder(
      buyer.id,
      seller.id,
      product.id,
      OrderStatus.PAID,
    );

    const report = await orders.reconcileUnheldEscrow({
      apply: false,
      orderIds: [o.id],
    });

    expect(report.apply).toBe(false);
    expect(report.scanned).toBe(1);
    expect(report.withConfirmedTx).toBe(0);
    expect(report.withoutConfirmedTx).toBe(1);
    expect(report.reverted).toBe(0);
    expect(report.held).toBe(0);

    const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(after.status).toBe(OrderStatus.PAID);
    expect(after.paidAt).not.toBeNull();
    expect(after.escrowStatus).toBe(EscrowStatus.NONE);
    const led = await escrowEntries(o.id);
    expect(led._sum.amount ?? 0).toBe(0);
  });

  it('случай (б): депозита нет → заказ возвращается в PENDING, paidAt обнулён', async () => {
    const o = await mkStuckOrder(
      buyer.id,
      seller.id,
      product.id,
      OrderStatus.SHIPPED,
    );

    const report = await orders.reconcileUnheldEscrow({
      apply: true,
      orderIds: [o.id],
    });

    expect(report.reverted).toBe(1);
    expect(report.held).toBe(0);
    expect(report.withoutConfirmedTx).toBe(1);
    expect(report.orderIds.reverted).toContain(o.id);

    const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(after.status).toBe(OrderStatus.PENDING);
    expect(after.paidAt).toBeNull();
    expect(after.shippedAt).toBeNull();
    expect(after.escrowStatus).toBe(EscrowStatus.NONE);
  });

  it('случай (а): есть Transaction CONFIRMED → холд досоздаётся, заказ в HELD', async () => {
    const amount = 250;
    const o = await mkStuckOrder(
      buyer.id,
      seller.id,
      product.id,
      OrderStatus.PAID,
      amount,
    );
    await prisma.transaction.create({
      data: {
        orderId: o.id,
        type: 'deposit',
        amount,
        status: TransactionStatus.CONFIRMED,
        clientRef: `mp-txn-${o.id}`,
        txHash: `0x${suffix}-case-a`,
        confirmedAt: new Date(),
      },
    });

    const report = await orders.reconcileUnheldEscrow({
      apply: true,
      orderIds: [o.id],
    });

    expect(report.held).toBe(1);
    expect(report.reverted).toBe(0);
    expect(report.withConfirmedTx).toBe(1);

    const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(after.status).toBe(OrderStatus.PAID);
    expect(after.escrowStatus).toBe(EscrowStatus.HELD);
    expect(after.escrowAmount).toBe(amount);
    expect(after.escrowHeldAt).not.toBeNull();
    expect(after.autoCompleteAt).not.toBeNull();

    const led = await escrowEntries(o.id);
    expect(led._sum.amount ?? 0).toBe(amount);
  });

  it('случай (а) для SHIPPED: дедлайн переносится на escrow_autocomplete_days', async () => {
    const amount = 90;
    const o = await mkStuckOrder(
      buyer.id,
      seller.id,
      product.id,
      OrderStatus.SHIPPED,
      amount,
    );
    await prisma.transaction.create({
      data: {
        orderId: o.id,
        type: 'deposit',
        amount,
        status: TransactionStatus.OVERPAID,
        clientRef: `mp-txn-${o.id}`,
        txHash: `0x${suffix}-case-a-shipped`,
        confirmedAt: new Date(),
      },
    });

    const report = await orders.reconcileUnheldEscrow({
      apply: true,
      orderIds: [o.id],
    });
    expect(report.held).toBe(1);

    const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(after.status).toBe(OrderStatus.SHIPPED);
    expect(after.escrowStatus).toBe(EscrowStatus.HELD);
    expect(after.escrowAmount).toBe(amount);

    // holdForOrder поставил бы +5 дней (ship deadline). Для уже
    // отправленного заказа дедлайн должен быть +7 (autocomplete).
    const days =
      (after.autoCompleteAt!.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(6);
    expect(days).toBeLessThan(8);
  });

  it('идемпотентность: второй прогон не меняет ничего', async () => {
    const o = await mkStuckOrder(
      buyer.id,
      seller.id,
      product.id,
      OrderStatus.PAID,
    );

    const first = await orders.reconcileUnheldEscrow({
      apply: true,
      orderIds: [o.id],
    });
    expect(first.reverted).toBe(1);

    const afterFirst = await prisma.order.findUniqueOrThrow({
      where: { id: o.id },
    });
    const ledgerFirst = await escrowEntries(o.id);

    const second = await orders.reconcileUnheldEscrow({
      apply: true,
      orderIds: [o.id],
    });
    expect(second.scanned).toBe(0);
    expect(second.reverted).toBe(0);
    expect(second.held).toBe(0);

    const afterSecond = await prisma.order.findUniqueOrThrow({
      where: { id: o.id },
    });
    expect(afterSecond.status).toBe(afterFirst.status);
    expect(afterSecond.paidAt).toEqual(afterFirst.paidAt);
    expect(afterSecond.escrowStatus).toBe(afterFirst.escrowStatus);
    const ledgerSecond = await escrowEntries(o.id);
    expect(ledgerSecond._sum.amount ?? 0).toBe(ledgerFirst._sum.amount ?? 0);
  });

  it('рубильник escrow_reconcile_legacy_apply управляет режимом', async () => {
    const o = await mkStuckOrder(
      buyer.id,
      seller.id,
      product.id,
      OrderStatus.PAID,
    );

    // Ключа нет — по умолчанию dry-run, мутаций нет.
    const dry = await orders.reconcileUnheldEscrow({ orderIds: [o.id] });
    expect(dry.apply).toBe(false);
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status,
    ).toBe(OrderStatus.PAID);

    // Включаем рубильник — без явного apply режим становится боевым.
    await settings.set(ESCROW_RECONCILE_APPLY_SETTING, 'true');
    const live = await orders.reconcileUnheldEscrow({ orderIds: [o.id] });
    expect(live.apply).toBe(true);
    expect(live.reverted).toBe(1);
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status,
    ).toBe(OrderStatus.PENDING);

    // Любое значение кроме 'true' — снова dry-run.
    await settings.set(ESCROW_RECONCILE_APPLY_SETTING, 'false');
    const o2 = await mkStuckOrder(
      buyer.id,
      seller.id,
      product.id,
      OrderStatus.PAID,
    );
    const off = await orders.reconcileUnheldEscrow({ orderIds: [o2.id] });
    expect(off.apply).toBe(false);
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: o2.id } })).status,
    ).toBe(OrderStatus.PAID);
  });
});