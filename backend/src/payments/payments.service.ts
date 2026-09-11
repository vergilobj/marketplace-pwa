import {
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LedgerAccount } from '@prisma/client';
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

  /** Покупатель инициирует оплату: сверка владельца + создание/возврат платежа. */
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

    return this.createPaymentForOrder(orderId);
  }

  /** Статус оплаты заказа: PENDING / CONFIRMED / SWEPT (+ depositAddress, txHash). */
  async getOrderPaymentStatus(orderId: string) {
    const tx = await this.prisma.transaction.findFirst({
      where: { orderId, type: 'payment' },
      orderBy: { createdAt: 'desc' },
    });
    if (!tx) {
      return { status: 'PENDING', depositAddress: null, txHash: null };
    }
    return {
      status: tx.status,
      depositAddress: tx.depositAddress,
      txHash: tx.txHash,
    };
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
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const skip = (page - 1) * limit;
    const where: any = {};
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
