/**
 * Срок рекламы (verify5/report.md §5) — интеграционный тест против РЕАЛЬНОЙ БД.
 *
 * Дыра: `activateAdForOrder` брал срок размещения из
 * `escrow_ship_deadline_days` (5 дней) вместо оплаченного `dto.days`.
 * Пользователь платил за 30 дней, получал 5: реклама гасла раньше срока, а
 * заказ через те же 5 дней авто-возвращался.
 *
 * Проверяем сквозной путь на настоящих данных: createAd(days=N) → webhook
 * депозита → реклама активна ровно на N дней (а не на 5 из настроек).
 *
 * Зачем реальная БД: срок хранится в payload платежа (Order/Post полей под
 * него нет), и проверить, что он переживает реальный webhook-путь вместе с
 * холдом эскроу, можно только на настоящих транзакциях.
 */
import { EscrowStatus, OrderStatus } from '@prisma/client';
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

describe('Срок рекламы = оплаченный dto.days (integration)', () => {
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

  const DAY_MS = 24 * 60 * 60 * 1000;

  const mkUser = async (name: string, role: 'SELLER' | 'ADMIN') => {
    const user = await prisma.user.create({
      data: {
        phone: `adterm-${name}-${suffix}`,
        name: `AdTerm ${name}`,
        role,
        referralCode: `adterm-${name}-${suffix}`,
      },
    });
    createdUserIds.push(user.id);
    return user;
  };

  beforeAll(async () => {
    await prisma.$connect();
    // Эскроу-окно оставляем «коротким» (5 дней из настроек) — именно с ним
    // раньше путался срок размещения. Настройку не меняем: тест должен
    // доказать независимость срока рекламы от окна эскроу.
    await settings.set('ad_price', String(AD_PRICE));
    await settings.set('escrow_ship_deadline_days', '5');
    posts.onModuleInit();
  });

  afterAll(async () => {
    // Полная уборка (W1 §2) — см. test-db-cleanup.ts. Namespace adterm-.
    await cleanupTestData(
      prisma,
      {
        userIds: createdUserIds,
        orderIds: createdOrderIds,
        postIds: createdPostIds,
      },
      { prefixes: ['adterm-'] },
    );
  });

  it('оплата рекламы на 30 дней → adExpireDate ≈ +30д (не +5д эскроу)', async () => {
    const seller = await mkUser('seller', 'SELLER');
    await mkUser('admin', 'ADMIN');

    fakePaymodProvider.createPayment.mockImplementation(
      async (_amount: number, _orderId: string, metadata: any) => ({
        success: true,
        transactionId: metadata.clientRef,
        status: 'pending',
        raw: {
          client_ref: metadata.clientRef,
          deposit_address: `0xadterm-${suffix}`,
          chain: 'bsc',
          token: 'USDT',
        },
      }),
    );

    const amount = AD_PRICE * AD_DAYS;
    const post = (await posts.createAd(seller.id, {
      title: 'Реклама на 30 дней',
      content: 'Срок = оплаченный',
      days: AD_DAYS,
    })) as any;
    const orderId = post.orderId as string;
    createdOrderIds.push(orderId);
    createdPostIds.push(post.id);

    // Оплаченный срок зафиксирован в payload платежа (схему не трогаем).
    const tx = await prisma.transaction.findFirstOrThrow({
      where: { orderId, type: 'payment' },
    });
    expect((tx.payload as any)?.adDays).toBe(AD_DAYS);

    // Покупатель платит → webhook → PAID + HELD → хук активирует рекламу.
    await webhook.handleDeposit({
      event: 'deposit',
      client_ref: `mp-txn-${orderId}`,
      tx_hash: `0xadterm-${suffix}`,
      amount_raw: toRaw(amount, 18),
      chain: 'bsc',
      token: 'USDT',
      to: `0xadterm-${suffix}`,
    });

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(OrderStatus.PAID);
    expect(order.escrowStatus).toBe(EscrowStatus.HELD);

    const fresh = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(fresh.isPinned).toBe(true);
    expect(fresh.adExpireDate).not.toBeNull();

    const days = (fresh.adExpireDate!.getTime() - Date.now()) / DAY_MS;
    // Ровно 30 дней (± запас на время выполнения теста), НЕ 5.
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30.01);

    // Окно эскроу при этом осталось коротким (5д) — сроки независимы.
    const escrowDays =
      (order.autoCompleteAt!.getTime() - Date.now()) / DAY_MS;
    expect(escrowDays).toBeGreaterThan(4.9);
    expect(escrowDays).toBeLessThanOrEqual(5.01);
    expect(escrowDays).toBeLessThan(days);
  });

  it('реклама на 3 дня → срок 3 дня (не 5 и не 30)', async () => {
    const seller = await mkUser('seller2', 'SELLER');
    await mkUser('admin2', 'ADMIN');

    fakePaymodProvider.createPayment.mockImplementation(
      async (_amount: number, _orderId: string, metadata: any) => ({
        success: true,
        transactionId: metadata.clientRef,
        status: 'pending',
        raw: {
          client_ref: metadata.clientRef,
          deposit_address: `0xadterm2-${suffix}`,
          chain: 'bsc',
          token: 'USDT',
        },
      }),
    );

    const days = 3;
    const post = (await posts.createAd(seller.id, {
      title: 'Реклама на 3 дня',
      content: 'Проверка короткого срока',
      days,
    })) as any;
    const orderId = post.orderId as string;
    createdOrderIds.push(orderId);
    createdPostIds.push(post.id);

    await webhook.handleDeposit({
      event: 'deposit',
      client_ref: `mp-txn-${orderId}`,
      tx_hash: `0xadterm2-${suffix}`,
      amount_raw: toRaw(AD_PRICE * days, 18),
      chain: 'bsc',
      token: 'USDT',
      to: `0xadterm2-${suffix}`,
    });

    const fresh = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    const actual = (fresh.adExpireDate!.getTime() - Date.now()) / DAY_MS;
    expect(actual).toBeGreaterThan(2.9);
    expect(actual).toBeLessThanOrEqual(3.01);
  });
});