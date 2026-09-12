/**
 * L1-ФИКС (ДЕФЕКТ 2): крон отмены неоплаченных заказов.
 *
 * Регрессия, которую закрываем: `cancelExpiredOrders` отменял ЛЮБОЙ PENDING
 * со `createdAt < now - ttl`. На боевой БД это 654 легаси-заказа (импорт
 * 01.08.2026): ветка (б) reconciler'а, возвращающая заказ в PENDING, сносила
 * их за один тик (30 с).
 *
 * Проверяем все три сценария ТЗ на РЕАЛЬНОЙ БД (тестовой — см. test-db-env.ts):
 *   1. свежий просроченный PENDING            → ОТМЕНЯЕТСЯ (штатный сценарий);
 *   2. старый PENDING (-30 дней)              → НЕ отменяется, в лог warn;
 *   3. PENDING со следом оплаты (paidAt != null) → НЕ отменяется, в лог warn.
 *
 * Дополнительно: заказ моложе TTL не трогается (ещё ждёт оплаты).
 */
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { cleanupTestData } from '../common/prisma/test-db-cleanup';
import { AuditService } from '../common/audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LedgerService } from '../payments/ledger.service';
import { EscrowService } from '../payments/escrow.service';
import { PaymentsService } from '../payments/payments.service';
import { OrdersService, CANCEL_MAX_AGE_MINUTES } from './orders.service';

describe('L1 (integration): cancelExpiredOrders — окно отмены', () => {
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

  const suffix = `l1-cancel-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const userIds: string[] = [];
  const orderIds: string[] = [];

  const mkUser = async (name: string) => {
    const user = await prisma.user.create({
      data: {
        phone: `l1-cancel-${name}-${suffix}`,
        name: `L1 ${name}`,
        role: 'SELLER',
        referralCode: `l1-cancel-${name}-${suffix}`,
      },
    });
    userIds.push(user.id);
    return user;
  };

  /** Заказ с управляемым createdAt/paidAt. */
  const mkOrder = async (
    buyerId: string,
    sellerId: string,
    createdAt: Date,
    paidAt: Date | null = null,
  ) => {
    const order = await prisma.order.create({
      data: {
        buyerId,
        sellerId,
        amount: 100,
        status: OrderStatus.PENDING,
        paidAt,
        // createdAt НЕ @updatedAt — Prisma позволяет задать явно.
        createdAt,
      },
    });
    orderIds.push(order.id);
    return order;
  };

  const statusOf = async (id: string) =>
    (await prisma.order.findUniqueOrThrow({ where: { id } })).status;

  let buyer: { id: string };
  let seller: { id: string };

  beforeAll(async () => {
    await prisma.$connect();
    await settings.set('order_payment_ttl_minutes', '15');
    buyer = await mkUser('buyer');
    seller = await mkUser('seller');
  });

  afterAll(async () => {
    await cleanupTestData(
      prisma,
      { userIds, orderIds },
      { prefixes: ['l1-cancel-'] },
    );
    await prisma.$disconnect();
  });

  it('отменяет свежий PENDING (создан 20 мин назад, не оплачен) — штатный сценарий', async () => {
    const order = await mkOrder(
      buyer.id,
      seller.id,
      new Date(Date.now() - 20 * 60_000),
    );

    const res = await orders.cancelExpiredOrders();

    expect(await statusOf(order.id)).toBe(OrderStatus.CANCELLED);
    expect(res.count).toBeGreaterThanOrEqual(1);
  });

  it('НЕ отменяет PENDING старше окна (30 дней) — это история/импорт', async () => {
    const old = await mkOrder(
      buyer.id,
      seller.id,
      new Date(Date.now() - 30 * 24 * 60 * 60_000),
    );

    const warn = jest.spyOn(
      (orders as unknown as { logger: { warn: (m: string) => void } }).logger,
      'warn',
    );
    const res = await orders.cancelExpiredOrders();

    expect(await statusOf(old.id)).toBe(OrderStatus.PENDING);
    expect(res.skippedOld).toBeGreaterThanOrEqual(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('не трогаем историю/импорт'),
    );
    warn.mockRestore();
  });

  it('НЕ отменяет PENDING со следом оплаты (paidAt != null)', async () => {
    const paid = await mkOrder(
      buyer.id,
      seller.id,
      new Date(Date.now() - 20 * 60_000),
      new Date(Date.now() - 19 * 60_000),
    );

    const warn = jest.spyOn(
      (orders as unknown as { logger: { warn: (m: string) => void } }).logger,
      'warn',
    );
    const res = await orders.cancelExpiredOrders();

    expect(await statusOf(paid.id)).toBe(OrderStatus.PENDING);
    expect(res.skippedPaid).toBeGreaterThanOrEqual(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('следом'),
    );
    warn.mockRestore();
  });

  it('НЕ отменяет заказ моложе TTL — он ещё реально ждёт оплаты', async () => {
    const fresh = await mkOrder(
      buyer.id,
      seller.id,
      new Date(Date.now() - 60_000),
    );

    await orders.cancelExpiredOrders();

    expect(await statusOf(fresh.id)).toBe(OrderStatus.PENDING);
  });

  it('CANCEL_MAX_AGE_MINUTES = 24 часа (окно зафиксировано)', () => {
    expect(CANCEL_MAX_AGE_MINUTES).toBe(1440);
  });
});