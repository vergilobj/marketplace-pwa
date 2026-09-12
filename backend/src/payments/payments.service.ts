import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LedgerAccount, Prisma } from '@prisma/client';
import { cartClientRef, readCartPayload, CartMeta } from './cart.util';
import { PrismaService } from '../common/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { NowPaymentsProvider } from './nowpayments.provider';
import { PaymodProvider } from './paymod.provider';
import { PaymodService } from './paymod.service';
import { LedgerService } from './ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EscrowService } from './escrow.service';
import { AdActivationHook } from './ad-activation.hook';
import { toRaw, round2, fromRaw } from './money.util';
import { clampLimit, clampPage } from '../common/dto/pagination.dto';

/** Финальные статусы оплаты, которые понимает фронт (CheckoutPage: isFinal). */
const FINAL_PAYMENT_STATUSES = ['CONFIRMED', 'SWEPT'];

/** Причины, по которым payout-транзакция в сети считается неуспешной. */
const PAYOUT_FAILED_STATES = new Set([
  'failed',
  'error',
  'rejected',
  'dropped',
  'reverted',
  'cancelled',
  'canceled',
]);

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private prisma: PrismaService,
    private settingsService: SettingsService,
    private nowPayments: NowPaymentsProvider,
    private paymod: PaymodProvider,
    private paymodService: PaymodService,
    private ledger: LedgerService,
    private notificationsService: NotificationsService,
    private escrowService: EscrowService,
    // NH5-ad: мост «депозит подтверждён → активация рекламы». @Optional —
    // чтобы юнит-тесты могли конструировать сервис без моста.
    @Optional() private readonly adActivation?: AdActivationHook,
  ) {}

  async createPaymentForOrder(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new Error('Заказ не найден');
    if (order.status !== 'PENDING')
      throw new Error('Order already paid or cancelled');

    // B8/§7.4: комиссии считаются в OrdersService.create / DealService.accept и
    // снапшотятся в Order. Здесь НЕ пересчитываем — иначе ставка, изменённая
    // между созданием и оплатой, изменит уже согласованную сумму.
    // Разбивка гарантируется при создании заказа.

    // Выбор провайдера. По умолчанию — paymod (BSC, USDT).
    const provider =
      (await this.settingsService.get('payment_provider')) || 'paymod';

    if (provider === 'paymod') {
      const chain = 'bsc';
      const token = 'USDT';
      const clientRef = `mp-txn-${order.id}`;
      const tokenDecimals = 18;

      // Депозит-адрес (детерминированный) через sidecar.
      const result = await this.paymod.createPayment(order.amount, order.id, {
        chain,
        token,
        clientRef,
      });

      const depositAddress = result.raw?.deposit_address;

      // amount — цена в USDT; в paymod передаём сырые атомарные единицы через
      // BigInt-математику (§6.3): Math.round(x * 1e18) теряет точность.
      const amountRaw = toRaw(order.amount, tokenDecimals);

      await this.prisma.transaction.create({
        data: {
          orderId: order.id,
          type: 'payment',
          amount: order.amount,
          status: 'PENDING',
          payload: result.raw,
          provider: 'PAYMOD',
          clientRef,
          depositAddress,
          chain,
          token,
          amountRaw,
          expectedAmountRaw: amountRaw,
          tokenDecimals,
        },
      });

      this.logger.log(
        `Paymod payment created: order=${order.id} addr=${depositAddress}`,
      );

      return {
        depositAddress,
        clientRef,
        status: 'PENDING',
      };
    }

    // Фолбэк — NowPayments (легаси).
    const result = await this.nowPayments.createPayment(order.amount, order.id, {
      currency: 'usd',
      description: `Order ${order.id}`,
    });

    await this.prisma.transaction.create({
      data: {
        orderId: order.id,
        type: 'payment',
        amount: order.amount,
        status: 'PENDING',
        payload: result.raw,
        provider: 'NOWPAYMENTS',
      },
    });

    return {
      invoiceUrl: result.raw?.invoice_url,
      transactionId: result.transactionId,
      status: result.status,
    };
  }

  /**
   * Покупатель инициирует оплату: сверка владельца + создание/возврат платежа.
   *
   * A3 (cart-aware): заказ может быть НЕ-якорным участником корзины. У него
   * нет своей Transaction (clientRef UNIQUE → на корзину ровно одна строка),
   * зато есть cart-транзакция с его id в payload.cart.orderIds. Без второго
   * шага ему бы всегда создавался ПЕРСОНАЛЬНЫЙ депозит-адрес на полную сумму
   * заказа → покупатель видел бы второй QR и мог заплатить дважды (второй
   * платёж ушёл бы в переплату). Поэтому сначала ищем cart-транзакцию.
   */
  async payOrderAsBuyer(orderId: string, userId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (order.buyerId !== userId) {
      throw new ForbiddenException('Платить может только покупатель заказа');
    }

    // Если депозит-адрес уже существует — вернуть его без создания дубля.
    const existing = await this.prisma.transaction.findFirst({
      where: { orderId, type: 'payment', provider: 'PAYMOD' },
      orderBy: { createdAt: 'desc' },
    });
    if (existing?.depositAddress) {
      return {
        depositAddress: existing.depositAddress,
        clientRef: existing.clientRef,
        amount: existing.amount,
        status: existing.status,
      };
    }

    // A3: заказ — участник общей оплаты корзины (не якорь).
    const cartTx = await this.findCartTransaction(orderId);
    if (cartTx?.depositAddress) {
      return {
        depositAddress: cartTx.depositAddress,
        clientRef: cartTx.clientRef,
        amount: cartTx.amount,
        status: cartTx.status,
        cart: true,
      };
    }

    return this.createPaymentForOrder(orderId);
  }

  /**
   * A3: ОДНА Transaction на всю корзину (anchor + payload.cart).
   *
   * Зачем: корзина из N товаров создавала N заказов, каждый со своим
   * депозит-адресом — покупатель платил N переводами. Схема не меняется:
   * `Transaction.orderId` NOT NULL, поэтому в нём лежит ЯКОРНЫЙ заказ,
   * а состав корзины — в `payload.cart` (никаких новых колонок, схему делят
   * другие билдеры).
   *
   * Идемпотентность двойная:
   *   1. `clientRef = mp-cart-<sha1(sorted ids)>` детерминирован, а sidecar
   *      выводит адрес из client_ref → повторный вызов даёт тот же адрес;
   *   2. UNIQUE(clientRef) не даст завести вторую строку на ту же корзину.
   */
  async createPaymentForCart(orderIds: string[], userId: string) {
    const ids = Array.from(new Set((orderIds || []).filter(Boolean)));
    if (ids.length < 2) {
      throw new BadRequestException(
        'Для общей оплаты нужно минимум 2 заказа (для одного хватает /payments/order/:id/pay)',
      );
    }

    const orders = await this.prisma.order.findMany({
      where: { id: { in: ids } },
      include: { post: { select: { isAd: true } } },
    });
    if (orders.length !== ids.length) {
      throw new NotFoundException('Часть заказов не найдена');
    }

    // Суммы и состав корзины — ТОЛЬКО из БД (клиент присылает лишь id).
    const perOrder: Array<{ orderId: string; amount: number }> = [];
    let total = 0;
    for (const order of orders) {
      if (order.buyerId !== userId) {
        throw new ForbiddenException('Платить может только покупатель заказов');
      }
      if (order.status !== 'PENDING') {
        throw new ConflictException(
          `Заказ ${order.id} уже оплачен или отменён (${order.status})`,
        );
      }
      // NH10: реклама оплачивается своим путём (createAd).
      if (order.post?.isAd === true) {
        throw new BadRequestException(
          `Заказ ${order.id} — рекламный, оплачивается отдельно`,
        );
      }
      perOrder.push({ orderId: order.id, amount: round2(order.amount) });
      total = round2(total + order.amount);
    }

    // Якорь: первый заказ по порядку id → ключ корзины стабилен между
    // вызовами независимо от порядка orderIds в теле запроса.
    const sortedIds = [...ids].sort();
    const anchorOrderId = sortedIds[0];
    const cartKey = this.cartClientRef(sortedIds);

    // Идемпотентность: корзина уже оплачивается/оплачена.
    const existing = await this.prisma.transaction.findUnique({
      where: { clientRef: cartKey },
    });
    if (existing?.depositAddress) {
      this.logger.log(`cart payment reused: ${cartKey} addr=${existing.depositAddress}`);
      return {
        depositAddress: existing.depositAddress,
        clientRef: existing.clientRef,
        amount: existing.amount,
        status: existing.status,
      };
    }

    const provider =
      (await this.settingsService.get('payment_provider')) || 'paymod';
    if (provider !== 'paymod') {
      throw new BadRequestException(
        'Общая оплата корзины поддерживается только провайдером paymod',
      );
    }

    const chain = 'bsc';
    const token = 'USDT';
    const tokenDecimals = 18;
    const result = await this.paymod.createPayment(total, anchorOrderId, {
      chain,
      token,
      clientRef: cartKey,
    });
    const depositAddress = result.raw?.deposit_address;
    const amountRaw = toRaw(total, tokenDecimals);

    // Одна строка на корзину. payload = ответ sidecar + cart-метаданные
    // (состав, суммы, якорь) — по ним webhook и status-эндпоинт находят
    // не-якорные заказы.
    const payload = {
      ...(this.asObject(result.raw) ?? {}),
      cart: {
        anchorOrderId,
        orderIds: sortedIds,
        total,
        perOrder,
      },
    };

    await this.prisma.transaction.create({
      data: {
        orderId: anchorOrderId,
        type: 'payment',
        amount: total,
        status: 'PENDING',
        payload: payload as Prisma.InputJsonValue,
        provider: 'PAYMOD',
        clientRef: cartKey,
        depositAddress,
        chain,
        token,
        amountRaw,
        expectedAmountRaw: amountRaw,
        tokenDecimals,
      },
    });

    this.logger.log(
      `Paymod CART payment created: anchor=${anchorOrderId} orders=${sortedIds.length} total=${total} addr=${depositAddress}`,
    );

    return {
      depositAddress,
      clientRef: cartKey,
      amount: total,
      status: 'PENDING',
    };
  }

  /**
   * A3: clientRef корзины — делегирует в cart.util (детерминированный
   * `mp-cart-<sha1(sorted ids)[0..16]>`). Метод оставлен как точка входа
   * сервиса, чтобы вызывающий код не зависел от свободной функции.
   */
  cartClientRef(sortedOrderIds: string[]): string {
    return cartClientRef(sortedOrderIds);
  }

  /**
   * Статус оплаты заказа: PENDING / CONFIRMED / SWEPT (+ depositAddress, txHash).
   *
   * A3 (cart-aware): у заказов корзины источник истины — ОБЩАЯ транзакция.
   * Личная транзакция якорного заказа остаётся PENDING-остатком от
   * OrdersService.create (её никто не оплачивает), а у не-якорных заказов
   * своей транзакции нет вовсе — поэтому сначала ищем cart-транзакцию.
   * Без этого фронт видел бы вечный PENDING и не закрывал корзину.
   */
  async getOrderPaymentStatus(orderId: string) {
    const cart = await this.findCartTransaction(orderId);
    const direct = await this.prisma.transaction.findFirst({
      where: { orderId, type: 'payment', provider: 'PAYMOD' },
      orderBy: { createdAt: 'desc' },
    });

    const tx = cart ?? direct;
    if (!tx) {
      return { status: 'PENDING', depositAddress: null, txHash: null };
    }

    let status: string = tx.status;
    if (cart) {
      // OVERPAID — это «оплачено с переплатой»: фронт знает только
      // CONFIRMED/SWEPT, поэтому отдаём ему понятный финальный статус.
      if (status === 'OVERPAID') status = 'CONFIRMED';
      // Страховка: заказ мог быть оплачен и личным адресом (покупатель
      // заплатил до создания корзины) — тогда смотрим на сам заказ.
      if (!FINAL_PAYMENT_STATUSES.includes(status)) {
        const order = await this.prisma.order.findUnique({
          where: { id: orderId },
          select: { status: true },
        });
        if (
          order &&
          order.status !== 'PENDING' &&
          order.status !== 'CANCELLED'
        ) {
          status = 'CONFIRMED';
        }
      }
    }

    return {
      status,
      depositAddress: tx.depositAddress,
      txHash: tx.txHash,
    };
  }

  /**
   * A3: cart-транзакция, в составе которой есть заказ (может быть не-якорным).
   * Поиск идёт и в БД (jsonb `@>`), и по детерминированному clientRef —
   * второй путь не зависит от поддержки JSON-операторов драйвером.
   */
  private async findCartTransaction(orderId: string) {
    const inPayload = await this.prisma.transaction.findFirst({
      where: {
        type: 'payment',
        provider: 'PAYMOD',
        payload: { path: ['cart', 'orderIds'], array_contains: orderId },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (inPayload) return inPayload;
    return this.prisma.transaction.findFirst({
      where: {
        type: 'payment',
        provider: 'PAYMOD',
        clientRef: { startsWith: 'mp-cart-' },
        payload: { path: ['cart', 'orderIds'], array_contains: orderId },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * A3: cart-метаданные транзакции (null для обычного заказа).
   * Делегирует в cart.util — там же логика для webhook-хендлера.
   */
  readCart(payload: unknown): CartMeta | null {
    return readCartPayload(payload);
  }

  /**
   * A3: разноска ОДНОГО депозита по корзине.
   *
   * Каждый заказ холдится ПООТДЕЛЬНОСТИ на свой `Order.amount` — инвариант
   * `platformFee + referral + net === amount` и эскроу-математика не трогаются.
   * Общая сумма проверяется на уровне корзины:
   *   - недоплата сверх допуска → НИ ОДИН заказ не становится PAID (частично
   *     оплаченная корзина запрещена: иначе половина позиций «оплачена», а
   *     половина висит до отмены кроном);
   *   - переплата → разница возвращается покупателю как `deposit_overpay`
   *     (внешний приток, поэтому выполняется после успешной разноски).
   *
   * Заказ, отменённый кроном `cancelExpiredOrders`, не теряет деньги: его доля
   * зачисляется покупателю как `orphan_deposit` (терминальный заказ вернуть в
   * PAID нельзя — он уже отменён). Размер доли берётся из состава корзины,
   * а не из общей суммы: иначе при одной отменённой позиции покупатель получил
   * бы назад всю корзину.
   */
  async processSuccessfulCartPayment(
    orderIds: string[],
    receivedRaw: bigint,
    decimals: number,
  ): Promise<{ paid: number; orphaned: number; overpaid: boolean }> {
    const uniqueIds = Array.from(new Set((orderIds || []).filter(Boolean)));
    const orders = await this.prisma.order.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, amount: true, status: true, buyerId: true },
    });

    const perOrder = orders.map((o) => ({ id: o.id, amount: round2(o.amount) }));
    const expectedRaw = perOrder.reduce(
      (acc, o) => acc + this.toRawBigInt(o.amount, decimals),
      0n,
    );

    const tolerancePct = await this.tolerancePercent();
    const relRaw =
      (expectedRaw * BigInt(Math.round(tolerancePct * 100))) / 10000n;
    const minRaw = this.toRawBigInt(0.01, decimals);
    const tolerance = relRaw > minRaw ? relRaw : minRaw;

    const human = fromRaw(receivedRaw, decimals);

    // ---- Недоплата: корзина не подтверждается целиком ----
    if (receivedRaw + tolerance < expectedRaw) {
      const shortfallRaw = expectedRaw - receivedRaw;
      this.logger.error(
        `ALERT CART UNDERPAID: orders=${uniqueIds.length} expected=${expectedRaw} ` +
          `received=${receivedRaw} shortfall=${shortfallRaw} — ни один заказ не подтверждён`,
      );
      const buyerId = orders[0]?.buyerId;
      if (buyerId) {
        await this.notifySafely(
          buyerId,
          'order',
          `Недоплата по корзине: пришло ${human}, нужно ${fromRaw(
            expectedRaw,
            decimals,
          )} USDT. Дошлите остаток (${fromRaw(shortfallRaw, decimals)} USDT).`,
          uniqueIds[0],
        );
      }
      return { paid: 0, orphaned: 0, overpaid: false };
    }

    let paid = 0;
    let orphaned = 0;

    for (const order of orders) {
      // Уже обработан (повторная доставка/догоняющий депозит) — не трогаем.
      if (order.status !== 'PENDING') {
        if (order.status !== 'PAID') {
          // Терминальный заказ: оплата пришла после отмены кроном.
          // Деньги покупателя не теряются — зачисляем его долю на AVAILABLE.
          await this.creditOrphanShare(order.id, order.buyerId, order.amount);
          orphaned++;
        }
        continue;
      }

      const claimed = await this.prisma.order.updateMany({
        where: { id: order.id, status: 'PENDING' },
        data: { status: 'PAID', paidAt: new Date() },
      });
      if (claimed.count === 0) {
        const fresh = await this.prisma.order.findUnique({
          where: { id: order.id },
          select: { status: true, buyerId: true, amount: true },
        });
        if (fresh && fresh.status !== 'PAID' && fresh.status !== 'PENDING') {
          await this.creditOrphanShare(
            order.id,
            fresh.buyerId,
            fresh.amount,
          );
          orphaned++;
        }
        continue;
      }

      try {
        const hold = await this.escrowService.holdForOrder(order.id);
        this.logger.log(
          `CART order ${order.id} PAID. Escrow ${hold.held ? 'HELD' : 'already held'}: ${hold.amount} USDT`,
        );
        // NH5-ad: реклама в корзину не попадает (createPaymentForCart её
        // отсекает), хук вызывается для полноты контура.
        try {
          await this.adActivation?.trigger(order.id);
        } catch (e) {
          this.logger.error(
            `ad activation after cart deposit failed for order ${order.id}: ${(e as Error).message}`,
          );
        }
        paid++;
      } catch (err) {
        // Компенсация: заказ возвращается в PENDING, исключение уходит наверх
        // (webhook 5xx → sidecar повторит доставку, разноска повторится).
        await this.prisma.order
          .updateMany({
            where: { id: order.id, status: 'PAID', escrowStatus: 'NONE' },
            data: { status: 'PENDING', paidAt: null },
          })
          .catch((e) =>
            this.logger.error(
              `CART order ${order.id} compensation to PENDING failed: ${(e as Error).message}`,
            ),
          );
        this.logger.error(
          `ALERT CART escrow hold failed for order ${order.id}: ${(err as Error).message}. Order reverted to PENDING for retry.`,
        );
        throw err;
      }
    }

    // Переплата корзины → на баланс покупателя. Только ПОСЛЕ разноски:
    // иначе при падении холда деньги уже были бы зачислены, а повторная
    // доставка webhook'а зачислила бы их снова (refKey по txHash спасает,
    // но порядок «сначала обязательства, потом остаток» — правильный).
    const overpayRaw = receivedRaw - expectedRaw;
    const buyerId = orders[0]?.buyerId;
    if (overpayRaw > 0n && buyerId) {
      const overHuman = fromRaw(overpayRaw, decimals);
      if (overHuman > 0) {
        await this.ledger.credit(null, {
          userId: buyerId,
          account: LedgerAccount.AVAILABLE,
          amount: overHuman,
          type: 'deposit_overpay',
          refKey: `deposit_overpay:cart:${uniqueIds
            .slice()
            .sort()
            .join(',')}`,
          orderId: uniqueIds[0],
        });
        await this.notifySafely(
          buyerId,
          'order',
          `Переплата ${overHuman} USDT зачислена на баланс.`,
          uniqueIds[0],
        );
      }
    }

    return { paid, orphaned, overpaid: overpayRaw > 0n };
  }

  /**
   * A3: доля отменённого/терминального заказа корзины → покупателю.
   * Идемпотентно по refKey (повторная доставка webhook'а — no-op).
   */
  private async creditOrphanShare(
    orderId: string,
    buyerId: string | null,
    amount: number,
  ): Promise<void> {
    const share = round2(amount);
    this.logger.error(
      `ALERT CART orphan deposit: заказ ${orderId} в терминальном статусе, доля ${share} USDT → на баланс покупателя`,
    );
    if (!buyerId || !(share > 0)) return;
    await this.ledger.credit(null, {
      userId: buyerId,
      account: LedgerAccount.AVAILABLE,
      amount: share,
      type: 'orphan_deposit',
      refKey: `orphan_deposit:cart-order:${orderId}`,
      orderId,
    });
    await this.notifySafely(
      buyerId,
      'order',
      `Депозит ${share} USDT зачислен на баланс: заказ ${orderId} был отменён.`,
      orderId,
    );
  }

  /** Инвариант «ожидаемая сумма в атомарных единицах» для корзины. */
  private toRawBigInt(amount: number, decimals: number): bigint {
    const micros = BigInt(Math.round(amount * 1_000_000));
    if (decimals <= 6) return micros / 10n ** BigInt(6 - decimals);
    return micros * 10n ** BigInt(decimals - 6);
  }

  private async tolerancePercent(): Promise<number> {
    const raw = await this.settingsService.getFloat('deposit_tolerance_percent');
    return Number.isFinite(raw) && raw > 0 ? raw : 1;
  }

  private asObject(value: unknown): Record<string, unknown> | null {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  }

  /**
   * NH7: сверка legacy-IPN NowPayments перед подтверждением заказа.
   *
   * Старый путь (`payments.controller.ts` handleIpn) подтверждал заказ по
   * payment_status=finished БЕЗ сверки суммы — легаси-заказ можно было
   * подтвердить на неполную оплату (та же дыра, что B7, но в старом
   * провайдере). Проверяем:
   *   1) заказ существует и ещё PENDING;
   *   2) у заказа ЕСТЬ транзакция провайдера NOWPAYMENTS — paymod-заказы
   *      подтверждаются только своим webhook'ом (с адресом/chain/суммой);
   *   3) фактически уплаченное (price_amount из IPN) совпадает с order.amount
   *      в допуске deposit_tolerance_percent (не меньше «факт + допуск»).
   *
   * @returns ok=false + reason, если подтверждать нельзя.
   */
  async verifyLegacyIpnPayment(
    orderId: string,
    body: Record<string, unknown>,
  ): Promise<{ ok: boolean; reason?: string }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, amount: true },
    });
    if (!order) return { ok: false, reason: 'order_not_found' };
    if (order.status !== 'PENDING') {
      // Уже оплачен/отменён — повторная доставка IPN не должна ничего менять.
      return { ok: false, reason: `order_not_pending:${order.status}` };
    }

    // Легаси-транзакция обязана существовать: иначе IPN с валидной подписью
    // (но чужого/другого провайдера) мог бы подтвердить paymod-заказ, у
    // которого нет ни депозит-адреса, ни сверки получателя.
    const legacyTx = await this.prisma.transaction.findFirst({
      where: { orderId, type: 'payment', provider: 'NOWPAYMENTS' },
      orderBy: { createdAt: 'desc' },
    });
    if (!legacyTx) return { ok: false, reason: 'no_legacy_transaction' };

    // Сверка суммы. price_amount — сумма в price_currency (USD) из IPN.
    const raw = body.price_amount ?? body.actually_paid;
    const paid =
      typeof raw === 'number' ? raw : raw === undefined ? NaN : Number(raw);
    if (!Number.isFinite(paid)) {
      return { ok: false, reason: 'unverifiable_price_amount' };
    }

    const tolerancePct = await this.settingsService.getFloat(
      'deposit_tolerance_percent',
    );
    const tolPct =
      Number.isFinite(tolerancePct) && tolerancePct > 0 ? tolerancePct : 1;
    const tolerance = Math.max((order.amount * tolPct) / 100, 0.01);

    if (paid + tolerance < order.amount) {
      this.logger.error(
        `ALERT legacy IPN UNDERPAID: order=${orderId} expected=${order.amount} paid=${paid}`,
      );
      return {
        ok: false,
        reason: `underpaid:expected=${order.amount},paid=${paid}`,
      };
    }

    return { ok: true };
  }

  /** Депозитный адрес для оплаты заказа (если создан через paymod). */
  async getOrderPayAddress(orderId: string) {
    const tx = await this.prisma.transaction.findFirst({
      where: { orderId, type: 'payment', provider: 'PAYMOD' },
      orderBy: { createdAt: 'desc' },
    });
    if (!tx?.depositAddress) {
      throw new Error('Payment address not found');
    }
    return { depositAddress: tx.depositAddress, clientRef: tx.clientRef };
  }

  /**
   * Подтверждение успешной оплаты заказа (§4.2 ТЗ).
   *
   * ВАЖНО (этап 3): здесь больше НЕ исполняется split. Деньги уходят в
   * ЭСКРОУ (заморозка) и лежат до релиза: COMPLETED покупателем, авто-таймаут
   * или вердикт арбитража. Реферальный бонус тоже НЕ начисляется здесь —
   * иначе при возврате пришлось бы откатывать уже выданный бонус (§4.2).
   *
   * Идемпотентность: атомарный guard updateMany({where:{status:PENDING}}).
   * Повторный webhook получает count=0 и выходит — без побочных эффектов.
   */
  async processSuccessfulPayment(orderId: string) {
    // 1. Атомарный guard от гонки (webhook может прийти дважды параллельно).
    const claimed = await this.prisma.order.updateMany({
      where: { id: orderId, status: 'PENDING' },
      data: { status: 'PAID', paidAt: new Date() },
    });
    if (claimed.count === 0) {
      this.logger.log(`Order ${orderId} already processed (not PENDING), skip`);
      return;
    }

    // 2. Холд эскроу: Order.escrowStatus = HELD, LedgerEntry(ESCROW, +amount).
    //    Идемпотентно на своём уровне (guard по escrowStatus=NONE + refKey).
    //
    // D4: шаги неатомарны — если холд падает (amount <= 0, ошибка БД,
    // рестарт процесса), заказ остаётся PAID с escrowStatus=NONE. Такой
    // заказ не попадает в autoCloseOrders (фильтр escrowStatus=HELD), не
    // закрывается через adminForceStatus и не возвращается — деньги
    // покупателя ушли в блокчейн, а обратного пути в коде нет.
    // Компенсация: откатываем статус в PENDING и бросаем ошибку наверх —
    // webhook вернёт 5xx, sidecar повторит доставку и холд выполнится заново.
    try {
      const hold = await this.escrowService.holdForOrder(orderId);
      this.logger.log(
        `Order ${orderId} PAID. Escrow ${hold.held ? 'HELD' : 'already held'}: ${hold.amount} USDT`,
      );

      // NH5-ad: депозит подтверждён и эскроу в HELD — если это рекламный
      // заказ, активируем рекламу. Раньше активация жила в PostsService.createAd
      // и срабатывала БЕЗ депозита (минт). Теперь — только здесь, на реальном
      // подтверждении оплаты. Best-effort: падение активации не должно
      // ломать денежный контур (заказ уже PAID+HELD, крон
      // PostsService.reconcilePaidAds догонит).
      try {
        await this.adActivation?.trigger(orderId);
      } catch (e) {
        this.logger.error(
          `ad activation after deposit failed for order ${orderId}: ${(e as Error).message}`,
        );
      }
    } catch (err) {
      await this.prisma.order
        .updateMany({
          where: { id: orderId, status: 'PAID', escrowStatus: 'NONE' },
          data: { status: 'PENDING', paidAt: null },
        })
        .catch((e) =>
          this.logger.error(
            `Order ${orderId} compensation to PENDING failed: ${(e as Error).message}`,
          ),
        );
      this.logger.error(
        `ALERT escrow hold failed for order ${orderId}: ${(err as Error).message}. Order reverted to PENDING for retry.`,
      );
      throw err;
    }
  }

  /**
   * D3 (§5.2 шаг 4a): подтверждение payout через getTxStatus.
   *
   * Старый код ставил payoutStatus='SUBMITTED', но статус заявки навсегда
   * оставался 'approved' — никто не опрашивал сеть. Хуже: при потере ответа
   * срабатывал catch → reversal, админ одобрял повторно → ВТОРАЯ выплата в
   * сеть (первую никто не отменял).
   *
   * Здесь: по каждой SUBMITTED-заявке спрашиваем фактический статус транзакции.
   *   CONFIRMED  → status='paid' (деньги ушли);
   *   FAILED     → reversal + возврат в pending (безопасный retry);
   *   PENDING    → оставляем, следующий тик проверит снова.
   * Reversal идемпотентен по refKey (attempt в ключе), поэтому повторный
   * проход не задваивает возврат.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async reconcilePayouts(): Promise<{ checked: number; confirmed: number; failed: number }> {
    const submitted = await this.prisma.withdrawalRequest.findMany({
      where: { payoutStatus: 'SUBMITTED', payoutTxHash: { not: null } },
      take: 50,
    });

    let confirmed = 0;
    let failed = 0;

    for (const request of submitted) {
      const txHash = request.payoutTxHash as string;
      try {
        const tx = await this.paymodService.getTxStatus(txHash);
        const status = (tx.status || '').toLowerCase();

        if (status === 'confirmed' || status === 'success' || status === 'swept') {
          await this.prisma.withdrawalRequest.update({
            where: { id: request.id },
            data: { status: 'paid', payoutStatus: 'CONFIRMED' },
          });
          await this.notifySafely(
            request.userId,
            'withdrawal',
            'Выплата подтверждена сетью.',
          );
          confirmed++;
        } else if (PAYOUT_FAILED_STATES.has(status)) {
          await this.settleFailedPayout(request.id, request.userId, txHash);
          failed++;
        }
        // PENDING/SUBMITTED — ждём следующий тик.
      } catch (err) {
        // Сеть недоступна — не трогаем, ретраим через 10 минут.
        this.logger.warn(
          `reconcile payout ${request.id} (${txHash}) failed: ${(err as Error).message}`,
        );
      }
    }

    if (confirmed || failed) {
      this.logger.log(
        `reconcilePayouts: checked=${submitted.length} confirmed=${confirmed} failed=${failed}`,
      );
    }
    return { checked: submitted.length, confirmed, failed };
  }

  /**
   * Разбор провалившейся выплаты: reversal + заявка → pending.
   * Сумма возврата выводится из фактических debit-проводок заявки, КОТОРЫЕ
   * ЕЩЁ НЕ ОТКАЧЕНЫ (дебеты всех попыток минус уже сделанные reversal'ы),
   * поэтому при нескольких попытках возвращается ровно остаток последней
   * неотменённой попытки, а не сумма всех. Идемпотентно по refKey с номером
   * попытки.
   */
  private async settleFailedPayout(
    requestId: string,
    userId: string,
    txHash: string,
  ): Promise<void> {
    const request = await this.prisma.withdrawalRequest.findUniqueOrThrow({
      where: { id: requestId },
    });
    if (request.status === 'paid') return; // уже подтверждён — не откатываем

    const parts = await this.debitPartsForRequest(requestId);
    // NH4: номер попытки берём из САМИХ проводок списания — это единый
    // источник истины для обоих путей reversal (users.service и этот).
    // Раньше здесь читался request.payoutAttempts, а в users.service —
    // вычислялся как (payoutAttempts ?? 0) + 1; значения совпадали лишь
    // косвенно. Теперь namespace withdrawal_reversal:<id>:<n>:<account>
    // нумеруется ровно тем же n, что и withdrawal_debit.
    const attempt = parts.attempt ?? request.payoutAttempts ?? 1;
    if (parts.fromAvailable <= 0 && parts.fromReferral <= 0) {
      // Уже откатывали (или списания не было) — только статус.
      await this.prisma.withdrawalRequest.update({
        where: { id: requestId },
        data: {
          status: 'pending',
          payoutStatus: 'FAILED',
          payoutError: `payout ${txHash} failed on-chain`,
        },
      });
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      if (parts.fromAvailable > 0) {
        await this.ledger.credit(tx, {
          userId,
          account: LedgerAccount.AVAILABLE,
          amount: parts.fromAvailable,
          type: 'withdrawal_reversal',
          refKey: `withdrawal_reversal:${requestId}:${attempt}:AVAILABLE`,
        });
      }
      if (parts.fromReferral > 0) {
        await this.ledger.credit(tx, {
          userId,
          account: LedgerAccount.REFERRAL,
          amount: parts.fromReferral,
          type: 'withdrawal_reversal',
          refKey: `withdrawal_reversal:${requestId}:${attempt}:REFERRAL`,
        });
      }
      await tx.withdrawalRequest.update({
        where: { id: requestId },
        data: {
          status: 'pending',
          payoutStatus: 'FAILED',
          payoutError: `payout ${txHash} failed on-chain, funds reversed`,
        },
      });
    });

    await this.notifySafely(
      userId,
      'withdrawal',
      'Выплата не прошла в сети, средства возвращены на баланс.',
    );
    this.logger.error(
      `ALERT payout ${requestId} (${txHash}) failed on-chain; reversed to balance`,
    );
  }

  /**
   * Фактические суммы списания заявки, которые ЕЩЁ НЕ откачены
   * (AVAILABLE / REFERRAL).
   *
   * NH4b (критично): журнал append-only и хранит дебеты ВСЕХ попыток вывода
   * (`withdrawal_debit:<id>:<n>:<account>` не удаляются при reversal'е).
   * Раньше здесь суммировались abs(amount) всех строк — при двух попытках по
   * 100 возврат составлял +200 вместо +100, т.е. деньги создавались из воздуха.
   *
   * Теперь: считаем сумму дебетов и ВЫЧИТАЕМ уже сделанные reversal'ы
   * (`withdrawal_reversal:<id>:<n>:<account>`). Попытка n считается закрытой,
   * если для пары (n, account) reversal уже записан. Возвращаем только
   * остаток — он инвариантен к числу попыток и самокорректируется.
   *
   * Устойчиво к повторам: если остаток 0, вызывающий код ничего не пишет;
   * даже при гонке уникальный refKey реверса не даст задвоить проводку.
   */
  private async debitPartsForRequest(
    requestId: string,
  ): Promise<{
    fromAvailable: number;
    fromReferral: number;
    attempt: number | null;
  }> {
    const debitPrefix = `withdrawal_debit:${requestId}:`;
    const reversalPrefix = `withdrawal_reversal:${requestId}:`;

    const rows = await this.prisma.ledgerEntry.findMany({
      where: {
        refKey: { startsWith: debitPrefix },
        type: 'withdrawal_debit',
      },
      select: { account: true, amount: true, refKey: true },
    });

    const reversalRows = await this.prisma.ledgerEntry.findMany({
      where: {
        refKey: { startsWith: reversalPrefix },
        type: 'withdrawal_reversal',
      },
      select: { refKey: true },
    });

    // Множество уже откаченных пар "<attempt>:<account>".
    const reversed = new Set<string>();
    for (const r of reversalRows) {
      const key = String(r.refKey ?? '');
      // Защита от источника, не применившего фильтр по refKey.
      if (!key.startsWith(reversalPrefix)) continue;
      const tail = key.slice(reversalPrefix.length);
      const sep = tail.indexOf(':');
      if (sep <= 0) continue;
      const n = parseInt(tail.slice(0, sep), 10);
      if (Number.isFinite(n) && n > 0) reversed.add(`${n}:${tail.slice(sep + 1)}`);
    }

    let fromAvailable = 0;
    let fromReferral = 0;
    // NH4: номер попытки парсим из refKey (`...:<id>:<n>:<account>`).
    // Легаси-формат без номера (`...:<id>:<account>`) даёт null.
    let attempt: number | null = null;
    for (const r of rows) {
      const key = String(r.refKey ?? '');
      if (!key.startsWith(debitPrefix)) continue;
      const tail = key.slice(debitPrefix.length);
      const sep = tail.indexOf(':');
      const account = sep >= 0 ? tail.slice(sep + 1) : tail;
      const parsed = sep > 0 ? parseInt(tail.slice(0, sep), 10) : NaN;
      const n = Number.isFinite(parsed) && parsed > 0 ? parsed : null;

      // Уже откачено своей же попыткой — возвращать нечего.
      if (n !== null && reversed.has(`${n}:${account}`)) continue;

      const abs = Math.abs(round2(r.amount));
      const acc = r.account ?? account;
      if (acc === 'AVAILABLE') fromAvailable = round2(fromAvailable + abs);
      else if (acc === 'REFERRAL') fromReferral = round2(fromReferral + abs);

      if (n !== null) attempt = attempt === null ? n : Math.max(attempt, n);
    }
    return { fromAvailable, fromReferral, attempt };
  }

  /** Уведомление не должно ронять денежную операцию. */
  private async notifySafely(
    userId: string,
    type: string,
    message: string,
    relatedId?: string,
  ): Promise<void> {
    try {
      await this.notificationsService.createNotification(
        userId,
        type,
        message,
        relatedId,
      );
    } catch (err) {
      this.logger.warn(
        `notification to ${userId} failed: ${(err as Error).message}`,
      );
    }
  }

  async getAllTransactions(filters?: {
    type?: string;
    orderSearch?: string;
    page?: number;
    limit?: number;
  }) {
    // L1: потолок limit — раньше `?limit=100000` отдавал всю таблицу транзакций.
    const page = clampPage(filters?.page, 1);
    const limit = clampLimit(filters?.limit, 20);
    const skip = (page - 1) * limit;
    const where: Prisma.TransactionWhereInput = {};
    if (filters?.type) {
      where.type = filters.type;
    }
    if (filters?.orderSearch) {
      where.orderId = { contains: filters.orderSearch, mode: 'insensitive' };
    }
    const [items, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          order: {
            select: { id: true, amount: true, status: true },
          },
        },
      }),
      this.prisma.transaction.count({ where }),
    ]);
    return { items, total, page, pages: Math.ceil(total / limit) };
  }
}
