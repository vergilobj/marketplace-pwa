/**
 * NH10 (КРИТ, integration, РЕАЛЬНАЯ БД) — возврат рекламного заказа через
 * арбитраж и через adminForceStatus больше не оставляет объявление в ленте.
 *
 * Дыра (verify7/report.md §3): NH9 закрыл бесплатный показ только на одном из
 * трёх путей закрытия эскроу — cron-таймаут (`autoCloseOrders` → `settleAdSale`).
 * Оставались два:
 *   A. арбитраж: рекламодатель сам открывает спор на СВОЁМ рекламном заказе
 *      (`buyerId` = он же, поэтому `assertOwner` пропускает), NH8-очередь берёт
 *      заказ (`deals: { none: {} }`), вердикт BUYER_RIGHT/SPLIT →
 *      `refundEscrow(100%/pct)` → деньги вернулись, `escrowStatus=REFUNDED`,
 *      а `Post.isPinned` остался `true` до `adExpireDate` → до 30 дней
 *      бесплатного показа в ленте;
 *   B. админ: `adminForceStatus REFUNDED` (или CANCELLED при HELD) → то же.
 *
 * Корень: `refundEscrow` не знал про рекламу, а единственное место, где
 * объявление гасится — `settleRelease(adSplit)` внутри `settleAdSale`.
 *
 * Фикс (вариант A из ТЗ): `refundEscrow` стал ad-aware — для заказа с
 * `Order.post.isAd` делегирует в `refundAdOrder`, который считает возврат за
 * НЕотработанные дни показа (как `adSettlement`) и гасит объявление в ТОЙ ЖЕ
 * транзакции. Плюс вариант B (defense in depth): спор на рекламном заказе
 * запрещён в `updateStatus(DISPUTED)` и в `adminForceStatus(DISPUTED)`.
 *
 * Тесты сквозные, на настоящих транзакциях: реальный `createAd` → реальный
 * webhook депозита (PAID + HELD + активация рекламы) → спор → реальный
 * `ArbitrageService.resolveDisputes` / реальный `adminForceStatus`. Моки не
 * покажут ни Prisma-связь `Order.post`, ни unique-индекс `Post.orderId`, ни
 * фактическое распределение денег в LedgerEntry.
 */
import { EscrowStatus, LedgerAccount, OrderStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { cleanupTestData } from '../common/prisma/test-db-cleanup';
import { AuditService } from '../common/audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LedgerService } from '../payments/ledger.service';
import { EscrowService } from '../payments/escrow.service';
import { PaymentsService } from '../payments/payments.service';
import { AdActivationHook } from '../payments/ad-activation.hook';
import { PaymodWebhookHandler } from '../payments/paymod-webhook.handler';
import { PostsService } from './posts.service';
import { OrdersService } from '../marketplace/orders.service';
import { ArbitrageService, VERDICT_MARKER } from '../bazar/arbitrage.service';
import { toRaw, addDays } from '../payments/money.util';

describe('NH10 (integration): возврат рекламы через арбитраж/админа гасит объявление', () => {
  const prisma = new PrismaService();

  const notify = {
    createNotification: jest.fn().mockResolvedValue(null),
    sendToUser: jest.fn().mockResolvedValue(null),
  } as unknown as NotificationsService;

  const ledger = new LedgerService(prisma, notify);
  const settings = new SettingsService(prisma);
  const audit = new AuditService(prisma);
  const escrow = new EscrowService(prisma, ledger, settings, notify);
  const adActivation = new AdActivationHook();

  const fakePaymodProvider = { createPayment: jest.fn() };
  const fakeNowPayments = { createPayment: jest.fn() };
  const fakePaymodService = { getTxStatus: jest.fn() };

  const payments = new PaymentsService(
    prisma,
    settings,
    fakeNowPayments as any,
    fakePaymodProvider as any,
    fakePaymodService as any,
    ledger,
    notify,
    escrow,
    adActivation,
  );

  const moderation = {
    moderate: jest.fn().mockResolvedValue({ verdict: 'allow' }),
  } as any;

  const posts = new PostsService(
    prisma,
    audit,
    settings,
    payments,
    notify,
    moderation,
    adActivation,
  );

  const orders = new OrdersService(
    prisma,
    audit,
    payments,
    escrow,
    settings,
    notify,
  );

  const webhook = new PaymodWebhookHandler(
    prisma,
    settings,
    ledger,
    notify,
    payments,
  );

  const suffix = `nh10-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const userIds: string[] = [];
  const orderIds: string[] = [];
  const postIds: string[] = [];
  const productIds: string[] = [];

  const AD_DAYS = 30;
  const AD_PRICE = 5000;
  const AD_AMOUNT = AD_PRICE * AD_DAYS; // 150000

  const mkUser = async (name: string, role: 'BUYER' | 'SELLER' | 'ADMIN') => {
    const user = await prisma.user.create({
      data: {
        phone: `${suffix}-${name}`,
        name: `NH10 ${name}`,
        role,
        referralCode: `${suffix}-${name}`,
      },
    });
    userIds.push(user.id);
    return user;
  };

  /**
   * Сдвигаем старт показа на `days` дней назад, эмулируя реальный таймлайн:
   * спор открывается не в день оплаты, объявление уже какое-то время
   * показывалось. Схему не трогаем — двигаем только даты.
   */
  const rewindAdStart = async (postId: string, days: number) => {
    const post = await prisma.post.findUniqueOrThrow({
      where: { id: postId },
      select: { adExpireDate: true },
    });
    await prisma.post.update({
      where: { id: postId },
      data: { adExpireDate: addDays(post.adExpireDate!, -days) },
    });
  };

  const mockPaymodPayment = () =>
    fakePaymodProvider.createPayment.mockImplementation(
      (_amount: number, _orderId: string, metadata: any) => ({
        success: true,
        transactionId: metadata.clientRef,
        status: 'pending',
        raw: {
          client_ref: metadata.clientRef,
          deposit_address: `0x${suffix}`,
          chain: 'bsc',
          token: 'USDT',
        },
      }),
    );

  const sumLedger = async (where: {
    orderId?: string;
    userId?: string;
    account?: LedgerAccount;
  }) => {
    const agg = await prisma.ledgerEntry.aggregate({
      where,
      _sum: { amount: true },
    });
    return agg._sum.amount ?? 0;
  };

  /**
   * Полный сквозной путь рекламного заказа: createAd → депозит → PAID+HELD →
   * активация объявления. Возвращает всё, что нужно тесту.
   */
  const createPaidAd = async (name: string, days = AD_DAYS) => {
    const advertiser = await mkUser(name, 'SELLER');
    await mkUser(`${name}-admin`, 'ADMIN');
    mockPaymodPayment();

    const post = (await posts.createAd(advertiser.id, {
      title: `NH10 реклама ${name}`,
      content: 'Проверка возврата через арбитраж/админа',
      days,
    })) as any;
    const orderId = post.orderId as string;
    orderIds.push(orderId);
    postIds.push(post.id);

    const amount = AD_PRICE * days;
    await webhook.handleDeposit({
      event: 'deposit',
      client_ref: `mp-txn-${orderId}`,
      tx_hash: `0x${suffix}-${name}`,
      amount_raw: toRaw(amount, 18),
      chain: 'bsc',
      token: 'USDT',
      to: `0x${suffix}`,
    });

    const paid = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(paid.status).toBe(OrderStatus.PAID);
    expect(paid.escrowStatus).toBe(EscrowStatus.HELD);

    const activated = await prisma.post.findUniqueOrThrow({
      where: { id: post.id },
    });
    expect(activated.isPinned).toBe(true);
    expect(activated.adExpireDate).not.toBeNull();

    return { advertiser, orderId, postId: post.id, amount };
  };

  beforeAll(async () => {
    await prisma.$connect();
    await settings.set('ad_price', String(AD_PRICE));
    await settings.set('escrow_ship_deadline_days', '5');
    posts.onModuleInit();
  });

  afterAll(async () => {
    // Полная уборка (W1 §2) — см. test-db-cleanup.ts. Namespace nh10-.
    await cleanupTestData(
      prisma,
      { userIds, orderIds, postIds, productIds },
      { prefixes: ['nh10-'] },
    );
  });

  // ============================================================
  // Вход 1 — арбитраж (маршрут A)
  // ============================================================

  it('арбитраж BUYER_RIGHT на рекламном заказе: объявление погашено, возврат только за неотработанные дни', async () => {
    const { advertiser, orderId, postId } = await createPaidAd(
      'arb-buyer',
      AD_DAYS,
    );

    // Показ шёл 5 дней, потом рекламодатель открыл спор на своём заказе.
    const SHOWN_DAYS = 5;
    await rewindAdStart(postId, SHOWN_DAYS);

    // Ровно то, что делал бы рекламодатель: PATCH status=DISPUTED.
    // buyerId рекламного заказа = сам рекламодатель, поэтому assertOwner
    // его пропускает — именно так дыра и эксплуатировалась.
    await prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.DISPUTED, autoCompleteAt: null },
    });

    // Реальный NH8-проход арбитража с вердиктом BUYER_RIGHT.
    const apiClient = {
      complete: jest.fn().mockResolvedValue({
        text: JSON.stringify({
          verdict: 'BUYER_RIGHT',
          confidence: 0.95,
          note: 'требую возврат',
        }),
      }),
    };
    const arbitrage = new ArbitrageService(
      prisma,
      apiClient as any,
      {} as any,
      escrow,
    );
    await arbitrage.resolveDisputes();

    expect(apiClient.complete).toHaveBeenCalledTimes(1);

    const settled = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    // Эскроу закрыт; заказ получил терминальный статус (как refundEscrow).
    expect(settled.escrowStatus).toBe(EscrowStatus.RELEASED);
    expect(settled.status).toBe(OrderStatus.REFUNDED);

    const perDay = AD_AMOUNT / AD_DAYS; // 5000 USDT/день
    const platformGot = await sumLedger({
      orderId,
      account: LedgerAccount.PLATFORM,
    });
    const advertiserGot = await sumLedger({
      orderId,
      userId: advertiser.id,
      account: LedgerAccount.AVAILABLE,
    });

    // ГЛАВНОЕ: объявление ПОГАШЕНО — возвращённые дни не показываются бесплатно.
    const closed = await prisma.post.findUniqueOrThrow({
      where: { id: postId },
    });
    expect(closed.isPinned).toBe(false);
    expect(closed.adExpireDate!.getTime()).toBeLessThanOrEqual(Date.now());

    // Возврат — НЕ 100%: платформа оставила себе плату за показанные дни.
    expect(advertiserGot).toBeGreaterThan(0);
    expect(advertiserGot).toBeLessThan(AD_AMOUNT);
    expect(advertiserGot).toBeGreaterThanOrEqual(
      perDay * (AD_DAYS - SHOWN_DAYS - 1),
    );
    expect(advertiserGot).toBeLessThanOrEqual(perDay * (AD_DAYS - SHOWN_DAYS));

    // Ни копейки не потеряно: платформа + рекламодатель = вся сумма.
    expect(platformGot).toBe(AD_AMOUNT - advertiserGot);
    expect(platformGot).toBeGreaterThanOrEqual(perDay);
    expect(await sumLedger({ orderId, account: LedgerAccount.ESCROW })).toBe(0);

    // Вердикт зафиксирован машиночитаемо (контракт payments).
    const parsed = JSON.parse(
      String(settled.cancelReason).slice(VERDICT_MARKER.length),
    );
    expect(parsed).toMatchObject({
      verdict: 'BUYER_RIGHT',
      source: 'order_no_deal',
    });

    // Повторный проход — no-op (заказ уже не DISPUTED + HELD).
    await arbitrage.resolveDisputes();
    expect(apiClient.complete).toHaveBeenCalledTimes(1);
    expect(await sumLedger({ orderId, account: LedgerAccount.PLATFORM })).toBe(
      platformGot,
    );
  });

  it('арбитраж SPLIT на рекламном заказе: объявление погашено, деньги не теряются', async () => {
    const { advertiser, orderId, postId } = await createPaidAd(
      'arb-split',
      AD_DAYS,
    );

    // Показ не начинался (isPinned=false) — при SPLIT/частичном услуга не
    // оказана, рекламодателю возвращается всё. Объявление при этом не должно
    // остаться висеть после закрытия заказа.
    await prisma.post.update({
      where: { id: postId },
      data: { isPinned: true, adExpireDate: addDays(new Date(), AD_DAYS) },
    });

    await prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.DISPUTED, autoCompleteAt: null },
    });

    const apiClient = {
      complete: jest.fn().mockResolvedValue({
        text: JSON.stringify({
          verdict: 'SPLIT',
          confidence: 0.9,
          note: 'пополам',
        }),
      }),
    };
    const arbitrage = new ArbitrageService(
      prisma,
      apiClient as any,
      {} as any,
      escrow,
    );
    await arbitrage.resolveDisputes();

    const settled = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(settled.escrowStatus).toBe(EscrowStatus.RELEASED);

    const closed = await prisma.post.findUniqueOrThrow({
      where: { id: postId },
    });
    expect(closed.isPinned).toBe(false);

    // Сумма частей сходится с эскроу: деньги не потеряны и не размножены.
    const platformGot = await sumLedger({
      orderId,
      account: LedgerAccount.PLATFORM,
    });
    const advertiserGot = await sumLedger({
      orderId,
      userId: advertiser.id,
      account: LedgerAccount.AVAILABLE,
    });
    expect(platformGot + advertiserGot).toBe(AD_AMOUNT);
  });

  // ============================================================
  // Вход 2 — админ (маршрут B)
  // ============================================================

  it('adminForceStatus REFUNDED на рекламном заказе: объявление погашено, возврат не 100%', async () => {
    const { advertiser, orderId, postId } = await createPaidAd(
      'admin-refund',
      AD_DAYS,
    );

    const SHOWN_DAYS = 5;
    await rewindAdStart(postId, SHOWN_DAYS);

    // Реальный админский путь — тот же, что был вторым входом дыры.
    await orders.adminForceStatus(
      orderId,
      { status: OrderStatus.REFUNDED },
      'ручной возврат рекламодателю',
    );

    const settled = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(settled.status).toBe(OrderStatus.REFUNDED);
    expect(settled.escrowStatus).toBe(EscrowStatus.RELEASED);

    // ГЛАВНОЕ: объявление погашено админским возвратом.
    const closed = await prisma.post.findUniqueOrThrow({
      where: { id: postId },
    });
    expect(closed.isPinned).toBe(false);
    expect(closed.adExpireDate!.getTime()).toBeLessThanOrEqual(Date.now());

    const perDay = AD_AMOUNT / AD_DAYS;
    const advertiserGot = await sumLedger({
      orderId,
      userId: advertiser.id,
      account: LedgerAccount.AVAILABLE,
    });
    const platformGot = await sumLedger({
      orderId,
      account: LedgerAccount.PLATFORM,
    });

    // Не 100% возврат: платформа удержала плату за показанные дни.
    expect(advertiserGot).toBeGreaterThan(0);
    expect(advertiserGot).toBeLessThan(AD_AMOUNT);
    expect(advertiserGot).toBeGreaterThanOrEqual(
      perDay * (AD_DAYS - SHOWN_DAYS - 1),
    );
    expect(platformGot).toBe(AD_AMOUNT - advertiserGot);
    expect(await sumLedger({ orderId, account: LedgerAccount.ESCROW })).toBe(0);
  });

  it('adminForceStatus CANCELLED на рекламном заказе: объявление погашено', async () => {
    const { advertiser, orderId, postId } = await createPaidAd(
      'admin-cancel',
      AD_DAYS,
    );

    await orders.adminForceStatus(
      orderId,
      { status: OrderStatus.CANCELLED },
      'отмена рекламного размещения',
    );

    const closed = await prisma.post.findUniqueOrThrow({
      where: { id: postId },
    });
    expect(closed.isPinned).toBe(false);
    expect(closed.adExpireDate!.getTime()).toBeLessThanOrEqual(Date.now());

    // Деньги не потеряны: эскроу пуст, платформа + рекламодатель = сумма.
    expect(await sumLedger({ orderId, account: LedgerAccount.ESCROW })).toBe(0);
    const advertiserGot = await sumLedger({
      orderId,
      userId: advertiser.id,
      account: LedgerAccount.AVAILABLE,
    });
    const platformGot = await sumLedger({
      orderId,
      account: LedgerAccount.PLATFORM,
    });
    expect(platformGot + advertiserGot).toBe(AD_AMOUNT);
  });

  // ============================================================
  // Вход 3 — вариант B: спор на рекламе запрещён
  // ============================================================

  it('вариант B: покупатель-рекламодатель НЕ может открыть спор на рекламном заказе', async () => {
    const { advertiser, orderId, postId } = await createPaidAd(
      'no-dispute',
      AD_DAYS,
    );

    // Рекламодатель в рекламном заказе — ПОКУПАТЕЛЬ (buyerId = он сам),
    // поэтому ровно так он и открывал спор на своём заказе.
    await expect(
      orders.updateStatus(orderId, advertiser.id, 'BUYER', {
        status: OrderStatus.DISPUTED,
      } as any),
    ).rejects.toThrow(/спор/i);

    // Заказ не тронут: деньги в эскроу, объявление показывается.
    const fresh = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(fresh.status).toBe(OrderStatus.PAID);
    expect(fresh.escrowStatus).toBe(EscrowStatus.HELD);

    const post = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
    expect(post.isPinned).toBe(true);
  });

  it('вариант B: админ НЕ может перевести рекламный заказ в спор', async () => {
    const { orderId } = await createPaidAd('admin-no-dispute', AD_DAYS);

    await expect(
      orders.adminForceStatus(
        orderId,
        { status: OrderStatus.DISPUTED } as any,
        'попробовать спор',
      ),
    ).rejects.toThrow(/спор/i);
  });

  // ============================================================
  // Не сломано: обычный товарный заказ (арбитраж + админ)
  // ============================================================

  it('обычный товарный заказ через арбитраж → полный возврат покупателю (не сломано)', async () => {
    const buyer = await mkUser('plain-buyer', 'BUYER');
    const seller = await mkUser('plain-seller', 'SELLER');

    const product = await prisma.product.create({
      data: {
        title: 'NH10 товар',
        price: 1000,
        media: [],
        sellerId: seller.id,
      },
    });
    productIds.push(product.id);

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

    await escrow.holdForOrder(order.id);
    await prisma.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.DISPUTED, autoCompleteAt: null },
    });

    const apiClient = {
      complete: jest.fn().mockResolvedValue({
        text: JSON.stringify({
          verdict: 'BUYER_RIGHT',
          confidence: 0.95,
          note: 'не прислали',
        }),
      }),
    };
    const arbitrage = new ArbitrageService(
      prisma,
      apiClient as any,
      {} as any,
      escrow,
    );
    await arbitrage.resolveDisputes();

    const fresh = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    // Обычный путь НЕ изменился: escrowStatus=REFUNDED, полный возврат.
    expect(fresh.escrowStatus).toBe(EscrowStatus.REFUNDED);
    expect(fresh.status).toBe(OrderStatus.REFUNDED);

    expect(
      await sumLedger({
        orderId: order.id,
        userId: buyer.id,
        account: LedgerAccount.AVAILABLE,
      }),
    ).toBe(1000);
    expect(
      await sumLedger({ orderId: order.id, account: LedgerAccount.ESCROW }),
    ).toBe(0);
    expect(
      await sumLedger({ orderId: order.id, account: LedgerAccount.PLATFORM }),
    ).toBe(0);
  });

  it('обычный товарный заказ: adminForceStatus REFUNDED возвращает 100% покупателю (не сломано)', async () => {
    const buyer = await mkUser('plain-admin-buyer', 'BUYER');
    const seller = await mkUser('plain-admin-seller', 'SELLER');

    const order = await prisma.order.create({
      data: {
        buyerId: buyer.id,
        sellerId: seller.id,
        amount: 1000,
        platformFee: 100,
        status: OrderStatus.PAID,
      },
    });
    orderIds.push(order.id);

    await escrow.holdForOrder(order.id);
    await orders.adminForceStatus(
      order.id,
      { status: OrderStatus.REFUNDED },
      'ручной возврат',
    );

    const fresh = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(fresh.status).toBe(OrderStatus.REFUNDED);
    expect(fresh.escrowStatus).toBe(EscrowStatus.REFUNDED);

    expect(
      await sumLedger({
        orderId: order.id,
        userId: buyer.id,
        account: LedgerAccount.AVAILABLE,
      }),
    ).toBe(1000);
    expect(
      await sumLedger({ orderId: order.id, account: LedgerAccount.PLATFORM }),
    ).toBe(0);
  });

  it('обычный товарный заказ: спор по-прежнему открывается', async () => {
    const buyer = await mkUser('plain-dispute-buyer', 'BUYER');
    const seller = await mkUser('plain-dispute-seller', 'SELLER');

    const order = await prisma.order.create({
      data: {
        buyerId: buyer.id,
        sellerId: seller.id,
        amount: 1000,
        platformFee: 100,
        status: OrderStatus.PAID,
      },
    });
    orderIds.push(order.id);
    await escrow.holdForOrder(order.id);

    const updated = await orders.updateStatus(order.id, buyer.id, 'BUYER', {
      status: OrderStatus.DISPUTED,
    });
    expect(updated.status).toBe(OrderStatus.DISPUTED);
  });
});
