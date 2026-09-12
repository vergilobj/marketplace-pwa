/**
 * NH9 (КРИТ, integration, РЕАЛЬНАЯ БД) — реклама не показывается бесплатно
 * после авто-возврата заказа.
 *
 * Дыра (verify6/report.md §3): рекламный заказ устроен так, что
 * `buyerId` = сам рекламодатель, `sellerId` = ADMIN, `platformFee` = вся сумма.
 * Через 5 дней (окно эскроу) `autoCloseOrders` видел `PAID + HELD`, звал
 * `refundEscrow(id, 'seller_no_ship_timeout', 100)` и возвращал рекламодателю
 * 100% денег — но объявление не гасилось (`posts.service.ts` escrow-методы не
 * зовёт вообще) и висело в ленте до `dto.days`. Убыток `ad_price × (days − 5)`
 * на каждом заказе; для 30 дней — 25 дней бесплатного показа.
 *
 * Фикс: рекламный заказ определяется по прямой связи `Order.post`
 * (`Post.orderId` @unique, пишется в createAd), и по таймауту закрывается
 * `settleAdSale`: эскроу уходит платформе за ОТРАБОТАННЫЕ дни, рекламодателю
 * возвращается доля за НЕотработанные, и объявление гасится в той же
 * транзакции. Бесплатного показа больше нет ни на один день.
 *
 * Тест сквозной и на настоящих транзакциях: createAd(30д) → реальный webhook
 * депозита (PAID + HELD + активация) → 5 дней показа → реальный
 * `autoCloseOrders` → проверяем, что платформа оставила себе плату за
 * показанные дни, рекламодателю вернулось только за непоказанные, объявление
 * погашено (чтобы возвращённые дни не показывались бесплатно), а повторный
 * прогон крона идемпотентен.
 *
 * Второй тест — «не сломали обычную покупку»: товарный заказ по тому же
 * таймауту по-прежнему возвращается покупателю. Третий — «услуга отработана
 * полностью»: срок показа истёк, платформа забирает всю сумму.
 *
 * Прогон против реальной БД нужен потому, что фикс держится на Prisma-связи
 * `Order.post` и на unique-индексе `Post.orderId` — моки этого не покажут.
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
import { toRaw, addDays } from '../payments/money.util';

describe('NH9 (integration): реклама не живёт после авто-закрытия заказа', () => {
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

  const suffix = `nh9-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
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
        name: `NH9 ${name}`,
        role,
        referralCode: `${suffix}-${name}`,
      },
    });
    userIds.push(user.id);
    return user;
  };

  /** Истёкший таймер: autoCloseOrders берёт заказы с autoCompleteAt < now. */
  const expireTimer = (orderId: string) =>
    prisma.order.update({
      where: { id: orderId },
      data: { autoCompleteAt: new Date(Date.now() - 60_000) },
    });

  /**
   * Сдвигаем старт показа на `days` дней назад, эмулируя реальный таймлайн:
   * autoCloseOrders срабатывает через 5 дней ПОСЛЕ оплаты, и всё это время
   * объявление показывалось. Схему не трогаем — двигаем только даты.
   */
  const rewindAdStart = async (
    orderId: string,
    postId: string,
    days: number,
  ) => {
    const post = await prisma.post.findUniqueOrThrow({
      where: { id: postId },
      select: { adExpireDate: true },
    });
    await prisma.post.update({
      where: { id: postId },
      data: { adExpireDate: addDays(post.adExpireDate!, -days) },
    });
    await prisma.order.update({
      where: { id: orderId },
      data: { escrowHeldAt: addDays(new Date(), -days) },
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

  beforeAll(async () => {
    await prisma.$connect();
    await settings.set('ad_price', String(AD_PRICE));
    await settings.set('escrow_ship_deadline_days', '5');
    // Регистрируем хук активации так же, как NestJS на старте приложения.
    posts.onModuleInit();
  });

  afterAll(async () => {
    // Полная уборка (W1 §2): раньше чистились только Post/Order/Product/
    // LedgerEntry по трекингу. Deal/BazarMessage/CounterOffer/Like/Comment/
    // ChatMessage не трогались, а Notification чистился лишь по tracked id —
    // накапливался мусор, и следующий прогон падал на RESTRICT-FK.
    await cleanupTestData(
      prisma,
      { userIds, orderIds, postIds, productIds },
      { prefixes: ['nh9-'] },
    );
  });

  it('рекламный заказ 30д: авто-закрытие → платформа берёт плату за показанные дни, реклама гасится', async () => {
    const advertiser = await mkUser('advertiser', 'SELLER');
    await mkUser('admin', 'ADMIN');
    mockPaymodPayment();

    // 1. Реклама на 30 дней → заказ PENDING, объявление НЕ активно.
    const post = (await posts.createAd(advertiser.id, {
      title: 'NH9 реклама 30 дней',
      content: 'Проверка бесплатного показа',
      days: AD_DAYS,
    })) as any;
    const orderId = post.orderId as string;
    orderIds.push(orderId);
    postIds.push(post.id);

    const created = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(created.amount).toBe(AD_AMOUNT);
    expect(created.platformFee).toBe(AD_AMOUNT);
    expect(created.buyerId).toBe(advertiser.id);
    expect(created.status).toBe(OrderStatus.PENDING);

    // 2. Реальная оплата → webhook → PAID + HELD → хук активирует рекламу.
    await webhook.handleDeposit({
      event: 'deposit',
      client_ref: `mp-txn-${orderId}`,
      tx_hash: `0x${suffix}`,
      amount_raw: toRaw(AD_AMOUNT, 18),
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

    const escrowHeld = await sumLedger({
      orderId,
      account: LedgerAccount.ESCROW,
    });
    expect(escrowHeld).toBe(AD_AMOUNT);

    // 3. Проходит 5 дней показа; таймер эскроу (5д) истекает — реальный cron.
    //    Сдвигаем начало показа на 5 дней назад: ровно тот таймлайн, на
    //    котором дыра NH9 давала 25 бесплатных дней.
    const SHOWN_DAYS = 5;
    await rewindAdStart(orderId, post.id, SHOWN_DAYS);
    await expireTimer(orderId);
    await orders.autoCloseOrders();

    // 4. Эскроу закрыт в пользу платформы (услуга оказана), не возвращён.
    const settled = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(settled.escrowStatus).toBe(EscrowStatus.RELEASED);
    expect(settled.escrowClosedAt).not.toBeNull();
    // Заказ не уходит в REFUNDED: реклама закрыта в пользу платформы.
    expect(settled.status).toBe(OrderStatus.PAID);

    const perDay = AD_AMOUNT / AD_DAYS; // 5000 USDT/день
    expect(await sumLedger({ orderId, account: LedgerAccount.ESCROW })).toBe(0);

    // Платформе — за ОТРАБОТАННЫЕ дни (5 из 30), не вся сумма и не ноль.
    const platformGot = await sumLedger({
      orderId,
      account: LedgerAccount.PLATFORM,
    });
    expect(platformGot).toBeGreaterThan(0);
    expect(platformGot).toBeLessThan(AD_AMOUNT);

    // Рекламодателю — за НЕотработанные дни (остаток), а не 100% возврат.
    const advertiserGot = await sumLedger({
      orderId,
      userId: advertiser.id,
      account: LedgerAccount.AVAILABLE,
    });
    // 24–25 дней из 30 (floor по миллисекундам) — то есть ~125000, а не
    // 150000 (полный возврат) и не 0.
    expect(advertiserGot).toBeGreaterThanOrEqual(
      perDay * (AD_DAYS - SHOWN_DAYS - 1),
    );
    expect(advertiserGot).toBeLessThanOrEqual(perDay * (AD_DAYS - SHOWN_DAYS));
    // Ни копейки не потеряно: платформа + рекламодатель = вся сумма.
    expect(platformGot).toBe(AD_AMOUNT - advertiserGot);
    expect(platformGot).toBeGreaterThanOrEqual(perDay); // ≥ плата за 1 день

    // 5. Объявление ПОГАШЕНО: возвращённые дни не показываются бесплатно.
    const afterClose = await prisma.post.findUniqueOrThrow({
      where: { id: post.id },
    });
    expect(afterClose.isPinned).toBe(false);
    expect(afterClose.adExpireDate!.getTime()).toBeLessThanOrEqual(Date.now());

    // 6. Повторный прогон крона — no-op (гард escrowStatus).
    const platformBefore = await sumLedger({
      orderId,
      account: LedgerAccount.PLATFORM,
    });
    await orders.autoCloseOrders();
    expect(await sumLedger({ orderId, account: LedgerAccount.PLATFORM })).toBe(
      platformBefore,
    );
  });

  it('услуга отработана полностью (срок истёк) → платформа забирает всю сумму, реклама гасится без возврата', async () => {
    const advertiser = await mkUser('advertiser-full', 'SELLER');
    await mkUser('admin-full', 'ADMIN');
    mockPaymodPayment();

    const post = (await posts.createAd(advertiser.id, {
      title: 'NH9 реклама отработана',
      content: 'Срок истёк',
      days: 3,
    })) as any;
    const orderId = post.orderId as string;
    orderIds.push(orderId);
    postIds.push(post.id);

    const amount = AD_PRICE * 3;
    await webhook.handleDeposit({
      event: 'deposit',
      client_ref: `mp-txn-${orderId}`,
      tx_hash: `0x${suffix}-full`,
      amount_raw: toRaw(amount, 18),
      chain: 'bsc',
      token: 'USDT',
      to: `0x${suffix}`,
    });

    // Реклама отстояла весь оплаченный срок: дедлайн уже в прошлом.
    await prisma.post.update({
      where: { id: post.id },
      data: { adExpireDate: new Date(Date.now() - 60_000) },
    });
    await expireTimer(orderId);

    await orders.autoCloseOrders();

    // Возвращать нечего: платформа забирает всю сумму.
    expect(await sumLedger({ orderId, account: LedgerAccount.PLATFORM })).toBe(
      amount,
    );
    expect(
      await sumLedger({
        orderId,
        userId: advertiser.id,
        account: LedgerAccount.AVAILABLE,
      }),
    ).toBe(0);
    expect(await sumLedger({ orderId, account: LedgerAccount.ESCROW })).toBe(0);

    const closed = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(closed.escrowStatus).toBe(EscrowStatus.RELEASED);

    // Объявление не показывается: срок истёк.
    const post2 = await prisma.post.findUniqueOrThrow({
      where: { id: post.id },
    });
    expect(post2.isPinned).toBe(false);
  });

  it('реклама не активировалась (услуга не оказана) → деньги целиком возвращаются рекламодателю, не платформе', async () => {
    const advertiser = await mkUser('advertiser-inactive', 'SELLER');
    await mkUser('admin-inactive', 'ADMIN');
    mockPaymodPayment();

    const post = (await posts.createAd(advertiser.id, {
      title: 'NH9 реклама без показа',
      content: 'Активация не прошла',
      days: 30,
    })) as any;
    const orderId = post.orderId as string;
    orderIds.push(orderId);
    postIds.push(post.id);

    await webhook.handleDeposit({
      event: 'deposit',
      client_ref: `mp-txn-${orderId}`,
      tx_hash: `0x${suffix}-inactive`,
      amount_raw: toRaw(AD_AMOUNT, 18),
      chain: 'bsc',
      token: 'USDT',
      to: `0x${suffix}`,
    });

    // Эмулируем сбой моста: заказ PAID + HELD, но объявление так и не
    // активировалось (isPinned=false, adExpireDate=null). Услуга не оказана.
    await prisma.post.update({
      where: { id: post.id },
      data: { isPinned: false, adExpireDate: null },
    });
    await expireTimer(orderId);

    await orders.autoCloseOrders();

    // Деньги вернулись рекламодателю целиком — платформа не берёт плату за
    // рекламу, которая ни дня не показывалась.
    expect(
      await sumLedger({
        orderId,
        userId: advertiser.id,
        account: LedgerAccount.AVAILABLE,
      }),
    ).toBe(AD_AMOUNT);
    expect(await sumLedger({ orderId, account: LedgerAccount.PLATFORM })).toBe(
      0,
    );
    expect(await sumLedger({ orderId, account: LedgerAccount.ESCROW })).toBe(0);
  });

  it('обычный товарный заказ по тому же таймауту → деньги возвращаются покупателю (не сломано)', async () => {
    const buyer = await mkUser('buyer', 'BUYER');
    const seller = await mkUser('seller', 'SELLER');

    const product = await prisma.product.create({
      data: {
        title: 'NH9 товар',
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
    await expireTimer(order.id);

    await orders.autoCloseOrders();

    const refunded = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(refunded.status).toBe(OrderStatus.REFUNDED);
    expect(refunded.escrowStatus).toBe(EscrowStatus.REFUNDED);
    expect(refunded.cancelReason).toBe('seller_no_ship_timeout');

    // Покупатель получил 1000 назад, эскроу пуст, платформа ничего не забрала.
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
});
