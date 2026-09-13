/**
 * Единая очистка тестовых данных после интеграционных прогонов (W1, проблема 2).
 *
 * Зачем: интеграционные спеки гоняются против РЕАЛЬНОЙ БД `marketplace`.
 * Точечные `deleteMany({ where: { id: { in: tracked } } })` в каждом afterAll
 * не покрывают таблицы, о которых тест не знает (Notification, AuditLog,
 * WithdrawalRequest, BazarMessage, CounterOffer, AutopilotRun, ...). Плюс
 * порядок удаления важен: часть FK объявлена БЕЗ onDelete, т.е. RESTRICT,
 * и удаление User падает целиком.
 *
 * Граф зависимостей (schema.prisma), кто мешает удалить User:
 *   Notification.userId              RESTRICT
 *   WithdrawalRequest.userId         RESTRICT
 *   LedgerEntry.userId               RESTRICT
 *   ChatMessage.senderId/receiverId  RESTRICT
 *   Comment.userId                   RESTRICT
 *   Like.userId                      RESTRICT
 *   Deal.buyerId/sellerId            RESTRICT
 *   Invite.ownerId/usedById          RESTRICT
 *   Product.sellerId                 RESTRICT
 *   Order.buyerId/sellerId           RESTRICT
 *   Post.authorId/adOwnerId          RESTRICT
 *   AuditLog.userId                  SET NULL (не мешает, но чистим)
 *   User.invitedById                 SET NULL
 *
 * Порядок фиксированный: листья → Post/Order/Product → User.
 * Raw SQL не нужен — все связи разрываются Prisma-запросами.
 *
 * Использование в afterAll спеки:
 *   await cleanupTestData(prisma, { userIds, orderIds, postIds, productIds },
 *                         { prefixes: ['ledger-test-', 'ledger-admin'] });
 *
 * `prefixes` — namespace ТОЛЬКО этой спеки. Это принципиально: jest гоняет
 * спеки параллельно, и общий свип по всем тестовым префиксам из чужого
 * afterAll снёс бы пользователей соседней спеки прямо во время её теста.
 * Каждый префикс принадлежит ровно одной спеке, поэтому свип внутри своего
 * namespace гонок не создаёт.
 */

import { PrismaService } from './prisma.service';
import { resolveTestDatabaseUrl } from './test-db-env';

/**
 * Все phone-префиксы, которыми пользуются тесты и ad-hoc скрипты.
 * Держать синхронно с mkUser() в спеках и scripts/*.
 * Полный список нужен только разовой уборке legacy-мусора
 * (scripts/clean-test-data.ts), спеки передают свой поднабор.
 *
 * ⚠️ L1-ФИКС: список обязан покрывать ВСЕ namespace'ы, иначе глобальный
 * teardown (test/jest-global-teardown.ts) не заметит остатки упавшей спеки.
 * Проверяется тестом test-db-namespace.spec.ts.
 */
export const ALL_TEST_PHONE_PREFIXES = [
  'ledger-test-', // ledger.service.spec.ts
  'ledger-admin', // ledger.service.spec.ts (алерт-тесты)
  'escrow-test-', // escrow.service.spec.ts
  'g1b-', // g1b-money / orders-reconcile integration
  'g1b-money-', // g1b-money.integration.spec.ts
  'h1-', // h1-deposit-end-to-end.integration.spec.ts
  'nh9-', // posts-nh9.integration.spec.ts
  'nh10-', // posts-nh10.integration.spec.ts
  'nh5ad-', // posts-nh5ad.integration.spec.ts
  'adterm-', // posts-ad-term.integration.spec.ts
  'b1-', // posts-ad-expire.integration.spec.ts
  'hv-', // arbitrage-nh8.integration.spec.ts
  'arb-', // arbitrage-*.spec.ts
  'g3-test-', // test/g3-idor-ad-url-race.e2e-spec.ts
  'bug1-sr-', // test/bug1-seller-request-validation.e2e-spec.ts
  'l1-cancel-', // l1-cancel-expired.integration.spec.ts
  'e2e-', // scripts/money-e2e.ts
  'alert-', // scripts/verify-money-alerts.js
  'fixcrit-', // users-search-leak.integration.spec.ts (FIX-CRIT regression)
];

/**
 * Минимальная длина phone-префикса. Префикс из одного символа (или пустая
 * строка) матчил бы половину боевой таблицы User — это ровно тот способ
 * «снести прод», от которого защищает guard ниже.
 */
const MIN_PREFIX_LEN = 3;

export interface TestDataIds {
  userIds?: string[];
  orderIds?: string[];
  postIds?: string[];
  productIds?: string[];
}

export interface CleanupOptions {
  /** phone-префиксы namespace этой спеки (см. предупреждение в шапке). */
  prefixes?: string[];
  /**
   * Подстрока, по которой добиваются «бесхозные» проводки LedgerEntry.
   *
   * Проводки PLATFORM намеренно пишутся с userId=null и orderId=null
   * (см. ledger.service.spec.ts: батч `test-batch-a/b`), поэтому ни по
   * пользователю, ни по заказу они не находятся и копятся между прогонами.
   * У таких проводок единственный след — refKey, куда тест зашивает свой
   * `suffix`. Передавайте сюда тот же suffix.
   */
  refKeyContains?: string;
}

/**
 * L1-ФИКС (ДЕФЕКТ 1): namespace-guard.
 *
 * Отказывается работать, если запрос может задеть строки, которые НЕ
 * доказано принадлежат тестам. Проверки:
 *   1. каждый префикс непустой и длиной ≥ MIN_PREFIX_LEN;
 *   2. если БД изолирована (`TEST_DATABASE_URL`) — guard пропускает всё:
 *      чужих данных там в принципе нет;
 *   3. в не-изолированном режиме (`DATABASE_URL`, как раньше) — каждый
 *      явно переданный orderId обязан ссылаться на нашего тестового
 *      пользователя (buyer/seller/referral). Чужой заказ не удаляется, а
 *      отбрасывается с предупреждением: лучше оставить мусор, чем снести
 *      боевую строку;
 *   4. общий предохранитель: если под удаление попалось ≥ BULK_ABORT_THRESHOLD
 *      пользователей — это признак сломанного префикса, свип отменяется
 *      целиком (throw), ничего не удаляется.
 */
export const BULK_ABORT_THRESHOLD = 100;

export function assertSafePrefixes(prefixes: string[]): void {
  for (const p of prefixes) {
    if (typeof p !== 'string' || p.length < MIN_PREFIX_LEN) {
      throw new Error(
        `cleanupTestData: небезопасный phone-префикс ${JSON.stringify(p)} — ` +
          `минимум ${MIN_PREFIX_LEN} символа (guard L1)`,
      );
    }
  }
}

/** Изоляция включена? (см. test-db-env.ts) */
export function isIsolatedTestDb(): boolean {
  return resolveTestDatabaseUrl().mode === 'test-db';
}

/**
 * Оставить только те orderId, что принадлежат нашему namespace.
 * Вызывается ДО удаления; возвращает безопасный список.
 */
export async function filterOwnOrderIds(
  prisma: PrismaService,
  orderIds: string[],
  userIds: string[],
): Promise<{ own: string[]; foreign: string[] }> {
  if (!orderIds.length) return { own: [], foreign: [] };
  if (isIsolatedTestDb()) return { own: orderIds, foreign: [] };

  const rows = await prisma.order.findMany({
    where: { id: { in: orderIds } },
    select: { id: true, buyerId: true, sellerId: true, referralUserId: true },
  });
  const mine = new Set(userIds);
  const own: string[] = [];
  const foreign: string[] = [];
  for (const r of rows) {
    const owned =
      mine.has(r.buyerId) ||
      mine.has(r.sellerId) ||
      (!!r.referralUserId && mine.has(r.referralUserId));
    (owned ? own : foreign).push(r.id);
  }
  // id, которых нет в БД, удалять нечего — считаем «своими» (no-op).
  const known = new Set(rows.map((r) => r.id));
  for (const id of orderIds) if (!known.has(id)) own.push(id);

  if (foreign.length) {
    // eslint-disable-next-line no-console
    console.warn(
      `[cleanupTestData] GUARD: отброшено ${foreign.length} чужих orderId ` +
        `(не связаны с тестовыми пользователями): ${foreign.slice(0, 5).join(', ')}`,
    );
  }
  return { own, foreign };
}

/** id юзеров: явно переданные + найденные по phone-префиксам namespace. */
export async function findTestUserIds(
  prisma: PrismaService,
  prefixes: string[],
  extraIds: string[] = [],
): Promise<string[]> {
  if (!prefixes.length && !extraIds.length) return [];
  assertSafePrefixes(prefixes);

  const rows = await prisma.user.findMany({
    where: {
      OR: [
        ...prefixes.map((p) => ({ phone: { startsWith: p } })),
        ...(extraIds.length ? [{ id: { in: extraIds } }] : []),
      ],
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * Полная уборка за прогоном. Идемпотентна: повторный вызов на пустых
 * наборах не делает ничего.
 *
 * @param ids  — id, которые накопил тест
 * @param opts — prefixes: namespace спеки (подхватит и мусор прошлых прогонов)
 */
export async function cleanupTestData(
  prisma: PrismaService,
  ids: TestDataIds = {},
  opts: CleanupOptions = {},
): Promise<void> {
  // Диагностический выключатель: позволяет проверить, не вносит ли сама
  // уборка гонок между спеками (в проде/CI не используется).
  if (process.env.FORGE_SKIP_TEST_CLEANUP === '1') return;

  const prefixes = opts.prefixes ?? [];
  const refKeyContains = opts.refKeyContains;
  assertSafePrefixes(prefixes);

  const userIds = await findTestUserIds(prisma, prefixes, ids.userIds ?? []);

  // L1-guard: предохранитель от «сломанного» префикса. Свип, нашедший сотни
  // пользователей, — это почти наверняка матч по боевым телефонам; лучше
  // упасть, чем удалить прод-данные.
  if (userIds.length >= BULK_ABORT_THRESHOLD) {
    throw new Error(
      `cleanupTestData: под удаление попало ${userIds.length} пользователей ` +
        `(≥ ${BULK_ABORT_THRESHOLD}) — префиксы ${JSON.stringify(prefixes)} ` +
        `подозрительно широкие, свип отменён (guard L1)`,
    );
  }
  const postIds = ids.postIds ?? [];
  const productIds = ids.productIds ?? [];

  if (
    !userIds.length &&
    !(ids.orderIds ?? []).length &&
    !postIds.length &&
    !productIds.length &&
    !refKeyContains
  ) {
    return;
  }

  const inUsers = { in: userIds };

  // Заказы ищем не только по переданным id, но и по ВСЕМ ссылкам на наших
  // пользователей: prefix-sweep подхватывает юзеров из прошлых (в т.ч.
  // упавших) прогонов, а их заказы в трекинге текущего теста отсутствуют.
  // Без этого `user.deleteMany` падает на Order_buyerId_fkey.
  const relatedOrders = userIds.length
    ? await prisma.order.findMany({
        where: {
          OR: [
            { buyerId: inUsers },
            { sellerId: inUsers },
            { referralUserId: inUsers },
            ...((ids.orderIds ?? []).length
              ? [{ id: { in: ids.orderIds } }]
              : []),
          ],
        },
        select: { id: true, productId: true },
      })
    : [];

  // L1-guard: из явно переданных orderId удаляем только «свои». В
  // не-изолированном режиме чужой id (например, опечатка в спеке) раньше
  // приводил к сносу боевого заказа вместе с его проводками.
  const { own: ownOrderIds } = await filterOwnOrderIds(
    prisma,
    ids.orderIds ?? [],
    userIds,
  );

  const orderIds = Array.from(
    new Set([...ownOrderIds, ...relatedOrders.map((o) => o.id)]),
  );
  const allProductIds = Array.from(
    new Set([
      ...productIds,
      ...relatedOrders.map((o) => o.productId).filter((p): p is string => !!p),
    ]),
  );

  const inOrders = { in: orderIds };
  const inProducts = { in: allProductIds };

  // ── 1. Листья: всё, что ссылается на User/Order/Product ───────────────
  await prisma.notification.deleteMany({ where: { userId: inUsers } });
  await prisma.auditLog.deleteMany({ where: { userId: inUsers } });
  // SellerRequest.userId — RESTRICT: без этого `user.deleteMany` падает.
  await prisma.sellerRequest.deleteMany({ where: { userId: inUsers } });
  await prisma.withdrawalRequest.deleteMany({ where: { userId: inUsers } });
  await prisma.autopilotRun.deleteMany({ where: { userId: inUsers } });
  await prisma.proactiveEvent.deleteMany({ where: { userId: inUsers } });
  await prisma.viewEvent.deleteMany({
    where: {
      OR: [
        { userId: inUsers },
        ...(productIds.length ? [{ productId: inProducts }] : []),
      ],
    },
  });

  await prisma.ledgerEntry.deleteMany({
    where: {
      OR: [
        { userId: inUsers },
        ...(orderIds.length ? [{ orderId: inOrders }] : []),
        ...(refKeyContains ? [{ refKey: { contains: refKeyContains } }] : []),
      ],
    },
  });
  if (orderIds.length) {
    await prisma.transaction.deleteMany({ where: { orderId: inOrders } });
  }

  // Deal ссылается на User (RESTRICT) и на Order.
  const deals = await prisma.deal.findMany({
    where: {
      OR: [
        { buyerId: inUsers },
        { sellerId: inUsers },
        ...(orderIds.length ? [{ orderId: inOrders }] : []),
      ],
    },
    select: { id: true },
  });
  const dealIds = deals.map((d) => d.id);

  await prisma.counterOffer.deleteMany({ where: { byUserId: inUsers } });
  if (dealIds.length) {
    const inDeals = { in: dealIds };
    await prisma.counterOffer.deleteMany({ where: { dealId: inDeals } });
    await prisma.bazarMessage.deleteMany({ where: { dealId: inDeals } });
  }
  await prisma.bazarMessage.deleteMany({ where: { userId: inUsers } });
  if (dealIds.length) {
    await prisma.deal.deleteMany({ where: { id: { in: dealIds } } });
  }

  // Post ссылается на User (authorId/adOwnerId) и на Order — сносим до Order.
  const posts = await prisma.post.findMany({
    where: {
      OR: [
        { authorId: inUsers },
        { adOwnerId: inUsers },
        ...(postIds.length ? [{ id: { in: postIds } }] : []),
        ...(orderIds.length ? [{ orderId: inOrders }] : []),
      ],
    },
    select: { id: true },
  });
  const allPostIds = Array.from(
    new Set([...postIds, ...posts.map((p) => p.id)]),
  );

  await prisma.like.deleteMany({ where: { userId: inUsers } });
  await prisma.comment.deleteMany({ where: { userId: inUsers } });
  if (allPostIds.length) {
    const inPosts = { in: allPostIds };
    await prisma.like.deleteMany({ where: { postId: inPosts } });
    await prisma.comment.deleteMany({ where: { postId: inPosts } });
    await prisma.post.deleteMany({ where: { id: inPosts } });
  }

  // ── 2. Заказы и товары ────────────────────────────────────────────────
  if (orderIds.length) {
    await prisma.order.deleteMany({ where: { id: inOrders } });
  }
  if (productIds.length) {
    await prisma.product.deleteMany({ where: { id: inProducts } });
  }
  await prisma.product.deleteMany({ where: { sellerId: inUsers } });

  // ── 3. Личные сообщения и инвайты (RESTRICT на User) ──────────────────
  await prisma.chatMessage.deleteMany({
    where: { OR: [{ senderId: inUsers }, { receiverId: inUsers }] },
  });
  await prisma.invite.deleteMany({
    where: { OR: [{ ownerId: inUsers }, { usedById: inUsers }] },
  });

  // ── 4. Сами пользователи ──────────────────────────────────────────────
  await prisma.user.deleteMany({ where: { id: inUsers } });
}
