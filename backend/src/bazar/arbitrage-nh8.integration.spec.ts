/**
 * NH8 (integration, РЕАЛЬНАЯ БД) — спор по заказу БЕЗ Deal доходит до арбитража.
 *
 * Сквозной путь: заказ маркетплейса без `dealId` → эскроу HELD → DISPUTED →
 * `ArbitrageService.resolveDisputes` сам находит заказ (раньше фильтр шёл
 * только по `Deal.dispute='OPEN'`), выносит вердикт и реально двигает эскроу.
 *
 * Почему интеграционный: юнит-тесты (`arbitrage-nh8.spec.ts`) работают на моках
 * Prisma и НЕ видят семантику SQL. Именно этот тест поймал реальный баг:
 * `NOT: { cancelReason: { startsWith: ... } }` в Prisma вырождается в
 * `NOT (col LIKE '...')` → для NULL это NULL → фильтр отбрасывал ВСЕ свежие
 * споры (у них cancelReason = null), и заказ без Deal снова оставался без
 * арбитража. Отсев эскалированных перенесён в JS — здесь это зафиксировано.
 */
import { EscrowStatus, LedgerAccount, OrderStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { cleanupTestData } from '../common/prisma/test-db-cleanup';
import { LedgerService } from '../payments/ledger.service';
import { EscrowService } from '../payments/escrow.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ArbitrageService, VERDICT_MARKER } from './arbitrage.service';

describe('NH8 (integration): спор по заказу без Deal доходит до арбитража', () => {
  const prisma = new PrismaService();
  const notify = {
    createNotification: jest.fn().mockResolvedValue(null),
    sendToUser: jest.fn().mockResolvedValue(null),
  } as unknown as NotificationsService;
  const ledger = new LedgerService(prisma, notify);
  const settings = new SettingsService(prisma);
  const escrow = new EscrowService(prisma, ledger, settings, notify);

  const suffix = `hv-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const userIds: string[] = [];
  const orderIds: string[] = [];
  const productIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    // Полная уборка (W1 §2) — см. test-db-cleanup.ts. Namespace hv-.
    // В этом тесте есть Deal без Order, поэтому точечный deleteMany по
    // orderIds его не находил, а Deal.buyerId/sellerId — RESTRICT: удаление
    // User падало, и оба юзера + сделка оставались в БД навсегда.
    await cleanupTestData(
      prisma,
      { userIds, orderIds, productIds },
      { prefixes: ['hv-'] },
    );
  });

  it('спор по заказу без Deal доходит до арбитража и эскроу реально возвращается', async () => {
    const buyer = await prisma.user.create({
      data: { phone: `hv-b-${suffix}`, name: 'HV buyer', role: 'BUYER', referralCode: `hv-b-${suffix}` },
    });
    const seller = await prisma.user.create({
      data: { phone: `hv-s-${suffix}`, name: 'HV seller', role: 'SELLER', referralCode: `hv-s-${suffix}` },
    });
    userIds.push(buyer.id, seller.id);

    const product = await prisma.product.create({
      data: { title: 'HV товар', price: 1000, media: [], sellerId: seller.id },
    });
    productIds.push(product.id);

    // Заказ маркетплейса: БЕЗ dealId — ровно тот случай, что не доходил до арбитража.
    const order = await prisma.order.create({
      data: {
        buyerId: buyer.id,
        sellerId: seller.id,
        productId: product.id,
        amount: 1000,
        platformFee: 100,
        status: OrderStatus.PAID,
      },
    });
    orderIds.push(order.id);

    // Депозит подтверждён → эскроу в HELD (реальные проводки в журнале).
    await escrow.holdForOrder(order.id);

    // Покупатель открывает спор.
    await prisma.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.DISPUTED, autoCompleteAt: null },
    });

    // Ни одной сделки по заказу — именно сломанный кейс.
    expect(await prisma.deal.count({ where: { orderId: order.id } })).toBe(0);

    const apiClient = {
      complete: jest.fn().mockResolvedValue({
        text: JSON.stringify({ verdict: 'BUYER_RIGHT', confidence: 0.95, note: 'не прислали' }),
      }),
    };
    const service = new ArbitrageService(
      prisma,
      apiClient as any,
      {} as any,
      escrow,
    );

    // Реальный cron-проход.
    await service.resolveDisputes();

    // 1. Арбитраж нашёл заказ без Deal (LLM вызван).
    expect(apiClient.complete).toHaveBeenCalledTimes(1);

    // 2. Деньги реально вернулись покупателю.
    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(fresh.escrowStatus).toBe(EscrowStatus.REFUNDED);
    expect(fresh.status).toBe(OrderStatus.REFUNDED);

    const escrowSum = await prisma.ledgerEntry.aggregate({
      where: { orderId: order.id, account: LedgerAccount.ESCROW },
      _sum: { amount: true },
    });
    expect(escrowSum._sum.amount ?? 0).toBe(0); // холд закрыт возвратом

    const buyerAvailable = await prisma.ledgerEntry.aggregate({
      where: { orderId: order.id, userId: buyer.id, account: LedgerAccount.AVAILABLE },
      _sum: { amount: true },
    });
    expect(buyerAvailable._sum.amount ?? 0).toBe(1000);

    // 3. Вердикт зафиксирован машиночитаемо (контракт payments).
    expect(String(fresh.cancelReason).startsWith(VERDICT_MARKER)).toBe(true);
    const parsed = JSON.parse(String(fresh.cancelReason).slice(VERDICT_MARKER.length));
    expect(parsed).toMatchObject({ verdict: 'BUYER_RIGHT', refundAmount: 1000, source: 'order_no_deal' });

    // 4. Повторный проход cron — no-op: заказ уже не DISPUTED+HELD.
    await service.resolveDisputes();
    expect(apiClient.complete).toHaveBeenCalledTimes(1);

    // 5. Двойная запись сходится: внутренние проводки возврата (ESCROW → AVAILABLE)
    //    в сумме дают 0. Проводка холда (+1000 ESCROW) — это внешний приток
    //    (реально пришедший депозит), она и должна остаться в журнале.
    const settlement = await prisma.ledgerEntry.aggregate({
      where: {
        orderId: order.id,
        type: { in: ['escrow_refund', 'platform_fee'] },
      },
      _sum: { amount: true },
    });
    expect(settlement._sum.amount ?? 0).toBe(0);

    // И реальное движение: эскроу пуст, у покупателя ровно возврат.
    const escrowAfter = await prisma.ledgerEntry.aggregate({
      where: { orderId: order.id, account: LedgerAccount.ESCROW },
      _sum: { amount: true },
    });
    expect(escrowAfter._sum.amount ?? 0).toBe(0);
  });
});