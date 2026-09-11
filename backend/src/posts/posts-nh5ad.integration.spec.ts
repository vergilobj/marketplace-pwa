/**
 * NH5-ad (КРИТ) — интеграционный тест против РЕАЛЬНОЙ БД.
 *
 * Дыра (verify4/report.md): `posts.service.ts:119` звал
 * `processSuccessfulPayment(order.id)` прямо в HTTP-хендлере создания
 * рекламы, ДО депозита. Заказ сразу становился PAID + escrowStatus=HELD
 * (LedgerEntry ESCROW без денег в блокчейне), реклама активировалась, а через
 * 5 дней `autoCloseOrders` возвращал «покупателю» (самому рекламодателю)
 * escrowAmount на AVAILABLE → вывод в BSC. Минт до ad_price × days.
 *
 * Проверяем оба конца:
 *   1) POST /posts/ad (createAd) → заказ PENDING, escrow NONE, реклама НЕ
 *      активна, в журнале нет ESCROW-проводки;
 *   2) webhook депозита paymod → заказ PAID + HELD, реклама активирована,
 *      ESCROW-проводка = сумма заказа, AVAILABLE-минта нет.
 *
 * Зачем реальная БД: идемпотентность холда и отсутствие «денег из воздуха»
 * проверяются только на настоящих транзакциях/unique-констрейнтах
 * (та же логика, что в escrow.service.spec.ts).
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
import { toRaw } from '../payments/money.util';

describe('NH5-ad: реклама не подтверждается без депозита (integration)', () => {
  const prisma = new PrismaService();
  const ledger = new LedgerService(prisma);
  const settings = new SettingsService(prisma);
  const audit = new AuditService(prisma);

  // Уведомления глушим: тест про деньги, не про OneSignal.
  const notify = {
    createNotification: jest.fn().mockResolvedValue(null),
    sendToUser: jest.fn().mockResolvedValue(null),
  } as unknown as NotificationsService;

  const escrow = new EscrowService(prisma, ledger, settings, notify);
  const adActivation = new AdActivationHook();

  // Провайдеры-заглушки: сеть в тесте не нужна.
  const fakePaymodProvider = {
    createPayment: jest.fn(),
  };
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

  // Модерацию глушим: вердикт allow, LLM не дёргаем.
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

  const webhook = new PaymodWebhookHandler(
    prisma,
    settings,
    ledger,
    notify,
    payments,
  );

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const createdUserIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdPostIds: string[] = [];
  const AD_DAYS = 30;
  const AD_PRICE = 5000;
  const AMOUNT = AD_PRICE * AD_DAYS; // 150000 — как в отчёте аудита

  const mkUser = async (name: string, role: 'SELLER' | 'ADMIN') => {
    const user = await prisma.user.create({
      data: {
        phone: `nh5ad-${name}-${suffix}`,
        name: `NH5ad ${name}`,
        role,
        referralCode: `nh5ad-${name}-${suffix}`,
      },
    });
    createdUserIds.push(user.id);
    return user;
  };

  beforeAll(async () => {
    await prisma.$connect();
    // Регистрируем хук так же, как это делает NestJS на старте приложения.
    posts.onModuleInit();
  });

  afterAll(async () => {
    // Полная уборка (W1 §2) — см. test-db-cleanup.ts. Namespace nh5ad-.
    await cleanupTestData(
      prisma,
      {
        userIds: createdUserIds,
        orderIds: createdOrderIds,
        postIds: createdPostIds,
      },
      { prefixes: ['nh5ad-'] },
    );
  });

  it('createAd → PENDING/NONE, без депозита оплата НЕ подтверждается', async () => {
    const seller = await mkUser('seller', 'SELLER');
    await mkUser('admin', 'ADMIN'); // platformUser для заказа

    fakePaymodProvider.createPayment.mockImplementation(
      async (_amount: number, _orderId: string, metadata: any) => ({
        success: true,
        transactionId: metadata.clientRef,
        status: 'pending',
        raw: {
          client_ref: metadata.clientRef,
          deposit_address: `0xdeposit-${suffix}`,
          chain: 'bsc',
          token: 'USDT',
        },
      }),
    );

    const post = (await posts.createAd(seller.id, {
      title: 'Реклама NH5-ad',
      content: 'Проверка дыры',
      days: AD_DAYS,
    })) as any;
    expect(post?.orderId).toBeTruthy();
    const orderId = post.orderId as string;
    createdOrderIds.push(orderId);
    createdPostIds.push(post.id);

    // 1. Заказ создан, но НЕ оплачен.
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(OrderStatus.PENDING);
    expect(order.escrowStatus).toBe(EscrowStatus.NONE);
    expect(order.escrowAmount).toBe(0);
    expect(order.amount).toBe(AMOUNT);

    // 2. Реклама НЕ активирована (иначе была бы бесплатной).
    const freshPost = await prisma.post.findUniqueOrThrow({
      where: { id: post.id },
    });
    expect(freshPost.isPinned).toBe(false);
    expect(freshPost.adExpireDate).toBeNull();

    // 3. В журнале НЕТ ESCROW-проводки — денег из воздуха не появилось.
    const escrowEntries = await prisma.ledgerEntry.findMany({
      where: { orderId, account: LedgerAccount.ESCROW },
    });
    expect(escrowEntries).toHaveLength(0);

    // 4. Никакого AVAILABLE у рекламодателя.
    const available = await prisma.ledgerEntry.aggregate({
      where: { userId: seller.id, account: LedgerAccount.AVAILABLE },
      _sum: { amount: true },
    });
    expect(available._sum.amount ?? 0).toBe(0);
  });

  it('webhook депозита → PAID + HELD, реклама активирована, ESCROW = сумма', async () => {
    const seller = await mkUser('seller2', 'SELLER');
    const admin = await mkUser('admin2', 'ADMIN');

    fakePaymodProvider.createPayment.mockImplementation(
      async (_amount: number, _orderId: string, metadata: any) => ({
        success: true,
        transactionId: metadata.clientRef,
        status: 'pending',
        raw: {
          client_ref: metadata.clientRef,
          deposit_address: `0xdeposit2-${suffix}`,
          chain: 'bsc',
          token: 'USDT',
        },
      }),
    );

    const post = (await posts.createAd(seller.id, {
      title: 'Реклама NH5-ad (оплата)',
      content: 'Проверка webhook-пути',
      days: AD_DAYS,
    })) as any;
    const orderId = post.orderId as string;
    createdOrderIds.push(orderId);
    createdPostIds.push(post.id);

    // Покупатель платит на депозит-адрес → sidecar шлёт webhook.
    await webhook.handleDeposit({
      event: 'deposit',
      client_ref: `mp-txn-${orderId}`,
      tx_hash: `0xnh5ad-${suffix}`,
      amount_raw: toRaw(AMOUNT, 18),
      chain: 'bsc',
      token: 'USDT',
      to: `0xdeposit2-${suffix}`,
    });

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(OrderStatus.PAID);
    expect(order.escrowStatus).toBe(EscrowStatus.HELD);
    expect(order.escrowAmount).toBe(AMOUNT);
    expect(order.paidAt).not.toBeNull();
    expect(order.autoCompleteAt).not.toBeNull();

    // Реклама активирована ТОЛЬКО теперь.
    const freshPost = await prisma.post.findUniqueOrThrow({
      where: { id: post.id },
    });
    expect(freshPost.isPinned).toBe(true);
    expect(freshPost.adExpireDate).not.toBeNull();
    expect(freshPost.adExpireDate!.getTime()).toBeGreaterThan(Date.now());

    // Эскроу-проводка ровно на сумму заказа; продавец=ADMIN, покупатель=SELLER.
    const escrowEntries = await prisma.ledgerEntry.findMany({
      where: { orderId, account: LedgerAccount.ESCROW },
    });
    expect(escrowEntries).toHaveLength(1);
    expect(escrowEntries[0].amount).toBe(AMOUNT);
    expect(escrowEntries[0].userId).toBe(seller.id);

    // Ключевое: НИКАКОГО AVAILABLE — баланс не нарисован из воздуха.
    const available = await prisma.ledgerEntry.aggregate({
      where: { userId: seller.id, account: LedgerAccount.AVAILABLE },
      _sum: { amount: true },
    });
    expect(available._sum.amount ?? 0).toBe(0);

    // Повторная доставка webhook — no-op (дедуп по txHash + идемпотентный холд).
    await webhook.handleDeposit({
      event: 'deposit',
      client_ref: `mp-txn-${orderId}`,
      tx_hash: `0xnh5ad-${suffix}`,
      amount_raw: toRaw(AMOUNT, 18),
      chain: 'bsc',
      token: 'USDT',
      to: `0xdeposit2-${suffix}`,
    });
    const escrowAfter = await prisma.ledgerEntry.count({
      where: { orderId, account: LedgerAccount.ESCROW },
    });
    expect(escrowAfter).toBe(1);
  });

  it('activateAdForOrder на неоплаченном заказе — no-op', async () => {
    const seller = await mkUser('seller3', 'SELLER');
    await mkUser('admin3', 'ADMIN');

    fakePaymodProvider.createPayment.mockImplementation(
      async (_amount: number, _orderId: string, metadata: any) => ({
        success: true,
        transactionId: metadata.clientRef,
        status: 'pending',
        raw: {
          client_ref: metadata.clientRef,
          deposit_address: `0xdeposit3-${suffix}`,
          chain: 'bsc',
          token: 'USDT',
        },
      }),
    );

    const post = (await posts.createAd(seller.id, {
      title: 'Реклама NH5-ad (не оплачена)',
      content: 'no-op',
      days: 1,
    })) as any;
    createdOrderIds.push(post.orderId as string);
    createdPostIds.push(post.id);

    // Пытаемся активировать рекламу напрямую по неоплаченному заказу.
    const activated = await posts.activateAdForOrder(post.orderId as string);
    expect(activated).toBe(false);
    const freshPost = await prisma.post.findUniqueOrThrow({
      where: { id: post.id },
    });
    expect(freshPost.isPinned).toBe(false);
  });
});