import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EscrowStatus, LedgerAccount, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AlertsService } from '../common/alerts/alerts.service';
import { round2 } from './money.util';
import {
  LedgerApplyOptions,
  LedgerApplyResult,
  LedgerBalances,
  LedgerInvariantError,
  LedgerInvariantReport,
  LedgerOp,
} from './dto/ledger.dto';

/** Минимальный контракт tx, достаточный LedgerService (реальный Prisma.TransactionClient). */
type LedgerTx = Prisma.TransactionClient;

/**
 * LedgerService — журнал внутренних денег (§1.1–1.2 ТЗ).
 *
 * Ключевой принцип: Transaction — учёт ВНЕШНИХ крипто-событий,
 * LedgerEntry — учёт ВНУТРЕННИХ денег. Смешивать нельзя.
 *
 * Все методы идемпотентны по refKey: повторный вызов не создаёт
 * вторую проводку, поэтому webhook/retry/cron не могут удвоить деньги.
 */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    // G2: внешний канал алертов. @Optional — LedgerService инстанцируется
    // в десятке спек руками (`new LedgerService(prisma, notify)`); без
    // @Optional каждый такой спек пришлось бы править, а в Nest DI резолвится
    // реальный AlertsService (внутри — тихий fallback при пустом env).
    @Optional() private readonly alerts?: AlertsService,
  ) {}

  // ============================================================
  // Ядро: атомарная запись проводок
  // ============================================================

  /**
   * Записать набор проводок.
   *
   * ВАЖНО: если передан `tx` — вызывающий уже внутри транзакции и
   * отвечает за её коммит. Если `tx` не передан — проводки применяются
   * в собственной транзакции.
   *
   * @param tx    — опциональный транзакционный клиент Prisma
   * @param ops   — список проводок
   */
  async apply(
    tx: LedgerTx | null,
    ops: LedgerOp[],
    options: LedgerApplyOptions = {},
  ): Promise<LedgerApplyResult> {
    if (!ops.length) return { applied: [], skipped: [] };

    const { assertZeroSum = false, idempotent = true } = options;

    this.validateOps(ops);

    if (assertZeroSum) {
      const total = round2(ops.reduce((acc, op) => acc + op.amount, 0));
      if (total !== 0) {
        throw new LedgerInvariantError(
          `apply: unbalanced ledger group, sum=${total} (must be 0)`,
        );
      }
    }

    if (tx) {
      return this.applyInTx(tx, ops, idempotent);
    }
    return this.prisma.$transaction((innerTx) =>
      this.applyInTx(innerTx, ops, idempotent),
    );
  }

  /** Одна проводка — сахар над apply(). */
  async applyOne(
    tx: LedgerTx | null,
    op: LedgerOp,
    options: LedgerApplyOptions = {},
  ): Promise<LedgerApplyResult> {
    return this.apply(tx, [op], options);
  }

  // ============================================================
  // Высокоуровневые операции
  // ============================================================

  /**
   * Холд эскроу: деньги покупателя замораживаются за заказом.
   * Это ВНЕШНИЙ приток (депозит уже пришёл в блокчейн), пары в журнале
   * у проводки нет → assertZeroSum не применяется.
   */
  async hold(
    tx: LedgerTx | null,
    params: {
      orderId: string;
      userId: string;
      amount: number;
      refKey?: string;
      dealId?: string | null;
      type?: string;
      meta?: Record<string, unknown>;
    },
  ): Promise<LedgerApplyResult> {
    const { orderId, userId, amount } = params;
    if (!(amount > 0)) {
      throw new LedgerInvariantError(
        `hold: amount must be > 0 (got ${amount})`,
      );
    }
    return this.apply(
      tx,
      [
        {
          account: LedgerAccount.ESCROW,
          amount: round2(amount),
          type: params.type ?? 'escrow_hold',
          refKey: params.refKey ?? `escrow_hold:order:${orderId}`,
          userId,
          orderId,
          dealId: params.dealId ?? null,
          meta: params.meta ?? null,
        },
      ],
      { assertZeroSum: false },
    );
  }

  /**
   * Зачисление на аккаунт пользователя (внешний приток:
   * возврат переплаты, сиротский депозит, реферальный бонус из сида).
   */
  async credit(
    tx: LedgerTx | null,
    params: {
      userId: string | null;
      account: LedgerAccount;
      amount: number;
      type: string;
      refKey: string;
      orderId?: string | null;
      dealId?: string | null;
      meta?: Record<string, unknown>;
    },
  ): Promise<LedgerApplyResult> {
    const { amount } = params;
    if (!(amount > 0)) {
      throw new LedgerInvariantError(
        `credit: amount must be > 0 (got ${amount})`,
      );
    }
    return this.apply(
      tx,
      [
        {
          account: params.account,
          amount: round2(amount),
          type: params.type,
          refKey: params.refKey,
          userId: params.userId,
          orderId: params.orderId ?? null,
          dealId: params.dealId ?? null,
          meta: params.meta ?? null,
        },
      ],
      { assertZeroSum: false },
    );
  }

  /**
   * Списание с аккаунта пользователя (внешний отток: выплата в сеть).
   * amount передаётся положительным, знак выставляется здесь.
   */
  async debit(
    tx: LedgerTx | null,
    params: {
      userId: string;
      account: LedgerAccount;
      amount: number;
      type: string;
      refKey: string;
      orderId?: string | null;
      dealId?: string | null;
      meta?: Record<string, unknown>;
    },
  ): Promise<LedgerApplyResult> {
    const { amount } = params;
    if (!(amount > 0)) {
      throw new LedgerInvariantError(
        `debit: amount must be > 0 (got ${amount})`,
      );
    }
    return this.apply(
      tx,
      [
        {
          account: params.account,
          amount: -round2(amount),
          type: params.type,
          refKey: params.refKey,
          userId: params.userId,
          orderId: params.orderId ?? null,
          dealId: params.dealId ?? null,
          meta: params.meta ?? null,
        },
      ],
      { assertZeroSum: false },
    );
  }

  /**
   * Релиз эскроу продавцу: распределение замороженной суммы по
   * PLATFORM / AVAILABLE(seller) / REFERRAL(referrer).
   *
   * Вызывается ВНУТРИ транзакции заказа (tx обязателен), потому что
   * решение о релизе и сам релиз должны быть атомарны (§4.3).
   */
  async release(
    tx: LedgerTx | null,
    params: {
      orderId: string;
      buyerId: string;
      sellerId: string;
      amount: number;
      platformFee: number;
      sellerNet: number;
      referralUserId?: string | null;
      referralBonus?: number;
      meta?: Record<string, unknown>;
    },
  ): Promise<LedgerApplyResult> {
    const { orderId } = params;
    const ops: LedgerOp[] = [
      {
        account: LedgerAccount.ESCROW,
        amount: -round2(params.amount),
        type: 'escrow_release',
        refKey: `escrow_release:${orderId}:ESCROW`,
        userId: params.buyerId,
        orderId,
      },
      {
        account: LedgerAccount.PLATFORM,
        amount: round2(params.platformFee),
        type: 'platform_fee',
        refKey: `escrow_release:${orderId}:PLATFORM`,
        userId: null,
        orderId,
      },
      {
        account: LedgerAccount.AVAILABLE,
        amount: round2(params.sellerNet),
        type: 'escrow_release',
        refKey: `escrow_release:${orderId}:AVAILABLE`,
        userId: params.sellerId,
        orderId,
      },
    ];

    if (params.referralUserId && (params.referralBonus ?? 0) > 0) {
      ops.push({
        account: LedgerAccount.REFERRAL,
        amount: round2(params.referralBonus as number),
        type: 'escrow_release',
        refKey: `escrow_release:${orderId}:REFERRAL`,
        userId: params.referralUserId,
        orderId,
      });
    }

    return this.apply(tx, ops, { assertZeroSum: true });
  }

  /**
   * Возврат эскроу покупателю (полный или частичный SPLIT, §5.1).
   * toBuyer + toSeller + feeCut === amount (проверяется инвариантом).
   */
  async refund(
    tx: LedgerTx | null,
    params: {
      orderId: string;
      buyerId: string;
      sellerId: string;
      amount: number;
      toBuyer: number;
      toSeller?: number;
      feeCut?: number;
      meta?: Record<string, unknown>;
    },
  ): Promise<LedgerApplyResult> {
    const { orderId } = params;
    const toSeller = round2(params.toSeller ?? 0);
    const feeCut = round2(params.feeCut ?? 0);

    const ops: LedgerOp[] = [
      {
        account: LedgerAccount.ESCROW,
        amount: -round2(params.amount),
        type: 'escrow_refund',
        refKey: `escrow_refund:${orderId}:ESCROW`,
        userId: params.buyerId,
        orderId,
      },
      {
        account: LedgerAccount.AVAILABLE,
        amount: round2(params.toBuyer),
        type: 'escrow_refund',
        refKey: `escrow_refund:${orderId}:AVAILABLE`,
        userId: params.buyerId,
        orderId,
      },
    ];

    if (toSeller > 0) {
      ops.push({
        account: LedgerAccount.AVAILABLE,
        amount: toSeller,
        type: 'escrow_refund',
        refKey: `escrow_refund:${orderId}:AVAILABLE_SELLER`,
        userId: params.sellerId,
        orderId,
      });
    }

    if (feeCut > 0) {
      ops.push({
        account: LedgerAccount.PLATFORM,
        amount: feeCut,
        type: 'platform_fee',
        refKey: `escrow_refund:${orderId}:PLATFORM`,
        userId: null,
        orderId,
      });
    }

    return this.apply(tx, ops, { assertZeroSum: true });
  }

  // ============================================================
  // Чтение и верификация
  // ============================================================

  /**
   * Балансы пользователя: кэш на User + агрегаты по журналу.
   * Если кэш и журнал разошлись — берём журнал (источник истины, §4.1).
   */
  async getBalances(userId: string): Promise<LedgerBalances> {
    const [grouped, escrowAgg, orderAgg] = await Promise.all([
      this.prisma.ledgerEntry.groupBy({
        by: ['account'],
        where: {
          userId,
          account: { in: [LedgerAccount.AVAILABLE, LedgerAccount.REFERRAL] },
        },
        _sum: { amount: true },
      }),
      this.prisma.ledgerEntry.aggregate({
        where: { userId, account: LedgerAccount.ESCROW },
        _sum: { amount: true },
      }),
      this.prisma.order.aggregate({
        where: { sellerId: userId, escrowStatus: 'HELD' },
        _sum: { escrowAmount: true },
      }),
    ]);

    const byAccount = new Map(
      grouped.map((g) => [g.account, g._sum.amount ?? 0]),
    );
    const available = round2(byAccount.get(LedgerAccount.AVAILABLE) ?? 0);
    const referral = round2(byAccount.get(LedgerAccount.REFERRAL) ?? 0);
    const escrowBalance = round2(escrowAgg._sum.amount ?? 0);
    const pendingEscrow = round2(orderAgg._sum.escrowAmount ?? 0);

    return {
      availableBalance: available,
      bonusBalance: referral,
      escrowBalance,
      pendingEscrow,
      totalWithdrawable: round2(available + referral),
    };
  }

  /**
   * Проверка инвариантов (§2 ТЗ):
   *   1. SUM(AVAILABLE per user) == User.availableBalance
   *   2. SUM(REFERRAL  per user) == User.bonusBalance
   *   3. SUM(ESCROW) == SUM(Order.escrowAmount WHERE escrowStatus = HELD)
   *
   * Расхождение по (1)/(2) на переходном периоде возможно там, где
   * bonusBalance был залит сид-данными — это warning, а не problem.
   * Расхождение по (3) — всегда problem (деньги потерялись/нарисовались).
   */
  async verifyInvariants(): Promise<LedgerInvariantReport> {
    const problems: string[] = [];
    const warnings: string[] = [];
    const checkedAt = new Date();

    const [accountTotals, users, heldEscrow, netInflow] = await Promise.all([
      this.prisma.ledgerEntry.groupBy({
        by: ['account'],
        _sum: { amount: true },
      }),
      this.prisma.user.findMany({
        select: { id: true, availableBalance: true, bonusBalance: true },
      }),
      this.prisma.order.aggregate({
        where: { escrowStatus: 'HELD' },
        _sum: { escrowAmount: true },
      }),
      this.prisma.ledgerEntry.aggregate({ _sum: { amount: true } }),
    ]);

    const totalsMap = new Map(
      accountTotals.map((t) => [t.account, round2(t._sum.amount ?? 0)]),
    );
    const available = totalsMap.get(LedgerAccount.AVAILABLE) ?? 0;
    const referral = totalsMap.get(LedgerAccount.REFERRAL) ?? 0;
    const escrow = totalsMap.get(LedgerAccount.ESCROW) ?? 0;
    const platform = totalsMap.get(LedgerAccount.PLATFORM) ?? 0;
    const heldOrdersEscrow = round2(heldEscrow._sum.escrowAmount ?? 0);
    const netExternalInflow = round2(netInflow._sum.amount ?? 0);

    // (3) главный мониторинг-алерт: журнал эскроу == заказы в HELD.
    if (escrow !== heldOrdersEscrow) {
      problems.push(
        `escrow mismatch: ledger ESCROW sum=${escrow} != orders HELD escrowAmount sum=${heldOrdersEscrow}`,
      );
    }

    // (1)/(2) покомпонентно по пользователям.
    const availableByUser = await this.prisma.ledgerEntry.groupBy({
      by: ['userId'],
      where: { account: LedgerAccount.AVAILABLE },
      _sum: { amount: true },
    });
    const referralByUser = await this.prisma.ledgerEntry.groupBy({
      by: ['userId'],
      where: { account: LedgerAccount.REFERRAL },
      _sum: { amount: true },
    });
    const availableMap = new Map(
      availableByUser.map((r) => [r.userId, round2(r._sum.amount ?? 0)]),
    );
    const referralMap = new Map(
      referralByUser.map((r) => [r.userId, round2(r._sum.amount ?? 0)]),
    );

    for (const user of users) {
      const ledgerAvailable = availableMap.get(user.id) ?? 0;
      const cachedAvailable = round2(user.availableBalance ?? 0);
      if (ledgerAvailable !== cachedAvailable) {
        problems.push(
          `user ${user.id}: availableBalance cache=${cachedAvailable} != ledger=${ledgerAvailable}`,
        );
      }

      const ledgerReferral = referralMap.get(user.id) ?? 0;
      const cachedReferral = round2(user.bonusBalance ?? 0);
      if (ledgerReferral !== cachedReferral) {
        // Сид-данные bonusBalance: журнала по ним нет → это warning.
        if (ledgerReferral === 0) {
          warnings.push(
            `user ${user.id}: bonusBalance=${cachedReferral} has no ledger history (legacy seed data)`,
          );
        } else {
          problems.push(
            `user ${user.id}: bonusBalance cache=${cachedReferral} != ledger=${ledgerReferral}`,
          );
        }
      }
    }

    if (problems.length) {
      this.logger.error(
        `Ledger invariants violated: ${problems.slice(0, 10).join(' | ')}`,
      );
    }

    return {
      ok: problems.length === 0,
      checkedAt,
      problems,
      warnings,
      totals: {
        available,
        referral,
        escrow,
        platform,
        heldOrdersEscrow,
        netExternalInflow,
      },
    };
  }

  /** История операций пользователя (для GET /users/me/ledger). */
  async getHistory(
    userId: string,
    params: { page?: number; limit?: number; account?: LedgerAccount } = {},
  ) {
    const page = params.page && params.page > 0 ? params.page : 1;
    const limit =
      params.limit && params.limit > 0 ? Math.min(params.limit, 100) : 20;

    const where: Prisma.LedgerEntryWhereInput = { userId };
    if (params.account) where.account = params.account;

    const [items, total] = await Promise.all([
      this.prisma.ledgerEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.ledgerEntry.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      pages: Math.ceil(total / limit) || 0,
    };
  }

  // ============================================================
  // Этап 10: мониторинг инвариантов (§2 ТЗ)
  // ============================================================

  /**
   * Cron-проверка инвариантов каждые 10 минут + реальный алерт.
   * verifyInvariants() был написан и покрыт тестами, но не вызывался
   * ниоткуда — главный мониторинг «деньги потерялись / нарисовались» не
   * работал. Здесь он подключён, логируется как ERROR (виден в проде) и
   * доставляется админам во внутренние уведомления (/notifications).
   *
   * Дополнительно гоняем реестр эскроу (findEscrowMismatches) — расхождение
   * статуса заказа и проводок ESCROW.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async runInvariantCheck(): Promise<{ ok: boolean; problems: number }> {
    try {
      const report = await this.verifyInvariants();
      const mismatches = await this.findEscrowMismatches();

      if (!report.ok) {
        this.logger.error(
          `ALERT money invariants violated (${report.problems.length}): ` +
            report.problems.slice(0, 5).join(' | '),
        );
      }
      if (mismatches.length) {
        this.logger.error(
          `ALERT escrow registry mismatch (${mismatches.length}): ` +
            mismatches
              .slice(0, 5)
              .map((m) => `${m.orderId}=${m.escrowStatus}/${m.ledgerEscrow}`)
              .join(' | '),
        );
      }

      // G2: наружу, а не только в БД. Раньше единственным адресатом были
      // Notification админам — если админ не залогинился, потеря денег
      // обнаруживалась через дни. Ошибки webhook глушатся внутри alerts.send,
      // а `?.` покрывает спеки, конструирующие сервис без AlertsService.
      //
      // ⚠️ Порядок важен: внешний алерт уходит ПОСЛЕ проверок, но ДО
      // alertAdmins — и обёрнут в safeSend, потому что брошенное исключение
      // здесь попало бы в общий catch и отменило бы доставку админам в БД.
      // Падение канала алертов не имеет права отменять основной алерт.
      if (!report.ok) {
        await this.safeSendAlert({
          code: 'money_invariants_violated',
          severity: 'error',
          message:
            `Нарушены инварианты журнала (${report.problems.length}): ` +
            report.problems.slice(0, 5).join(' | '),
          context: {
            problems: report.problems.length,
            sample: report.problems.slice(0, 5),
          },
        });
      }
      if (mismatches.length) {
        await this.safeSendAlert({
          code: 'escrow_registry_mismatch',
          severity: 'error',
          message:
            `Расхождения реестра эскроу (${mismatches.length}): ` +
            mismatches
              .slice(0, 5)
              .map((m) => `${m.orderId}=${m.escrowStatus}/${m.ledgerEscrow}`)
              .join(' | '),
          context: {
            mismatches: mismatches.length,
            sample: mismatches.slice(0, 5).map((m) => m.orderId),
          },
        });
      }

      // Доставка админам: одна нотификация на прогон, а не на проблему —
      // иначе /notifications забивается одинаковыми записями каждые 10 мин.
      await this.alertAdmins(report.problems, mismatches);
      await this.alertAdminsInvariantWarnings(report.warnings);

      return { ok: report.ok, problems: report.problems.length };
    } catch (err) {
      this.logger.error(`invariant check failed: ${(err as Error).message}`);
      await this.notifyAdminsSafely(
        'money_alert_failure',
        `Проверка денежных инвариантов упала: ${(err as Error).message}`,
      );
      return { ok: false, problems: -1 };
    }
  }

  /**
   * Разослать алерт всем ADMIN-пользователям.
   *
   * Реестр эскроу всегда problem-level; warnings (легаси-сид bonusBalance)
   * уходят отдельным типом, чтобы админ видел их отдельно от реальных
   * нарушений. Дедуп по типу+сообщению за последний час — cron не должен
   * плодить одно и то же каждые 10 минут.
   */
  private async alertAdmins(
    problems: string[],
    mismatches: Array<{
      orderId: string;
      escrowStatus: EscrowStatus;
      ledgerEscrow: number;
    }>,
  ): Promise<void> {
    if (!problems.length && !mismatches.length) return;

    const lines: string[] = [];
    if (problems.length) {
      lines.push(`Нарушения инвариантов журнала (${problems.length}):`);
      lines.push(...problems.slice(0, 5));
    }
    if (mismatches.length) {
      lines.push(`Расхождения реестра эскроу (${mismatches.length}):`);
      lines.push(
        ...mismatches
          .slice(0, 5)
          .map(
            (m) =>
              `order ${m.orderId}: статус ${m.escrowStatus}, в журнале ${m.ledgerEscrow}`,
          ),
      );
    }

    await this.notifyAdminsSafely('money_alert', lines.join('\n'));
  }

  /** Warning-уровень (легаси-сид) — отдельный тип, чтобы не тонул в алертах. */
  private async alertAdminsInvariantWarnings(
    warnings: string[],
  ): Promise<void> {
    if (!warnings.length) return;
    const lines = [
      `Предупреждения журнала (${warnings.length}):`,
      ...warnings.slice(0, 5),
    ];
    await this.notifyAdminsSafely('money_warning', lines.join('\n'));
  }

  /**
   * G2: отправить внешний алерт, не давая ему уронить вызывающий поток.
   *
   * `AlertsService.send` уже спроектирован так, что не бросает. Этот хелпер
   * страхует саму проводку: если алерт-канал подменён/сломан и бросает,
   * `runInvariantCheck` не должен из-за этого попасть в общий catch — иначе
   * исключение отменит доставку алерта админам в БД (notifyAdminsSafely) и
   * вернёт problems: -1, потеряв реальные нарушения.
   */
  private async safeSendAlert(alert: {
    code: string;
    severity?: 'error' | 'warning';
    message: string;
    context?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.alerts?.send(alert);
    } catch (err) {
      this.logger.warn(
        `external alert delivery threw (code=${alert.code}): ${
          (err as Error).message
        }`,
      );
    }
  }

  /**
   * Создать Notification каждому ADMIN. Если записей с role=ADMIN нет —
   * пишем в лог: молчаливый пропуск алерта — это ровно тот баг, который
   * чиним.
   *
   * LedgerService инстанцируется дважды (PaymentsModule и UsersModule — так
   * разорван цикл AuthModule → UsersModule), поэтому @Cron срабатывает два
   * раза в одну миллисекунду. Проверка «уже есть?» + вставка — это TOCTOU-
   * гонка: оба инстанса видели пустую таблицу и писали дубль. Поэтому
   * проверка и вставка идут под pg_advisory_xact_lock — второй инстанс
   * ждёт коммита первого и видит уже созданную запись.
   */
  private async notifyAdminsSafely(
    type: string,
    message: string,
  ): Promise<void> {
    try {
      const admins = await this.prisma.user.findMany({
        where: { role: UserRole.ADMIN },
        select: { id: true },
      });

      if (!admins.length) {
        this.logger.error(
          `No ADMIN users found — ${type} alert not delivered: ${message.slice(0, 200)}`,
        );
        return;
      }

      const since = new Date(Date.now() - 60 * 60 * 1000);
      const lockKey = `${type}:${message}`;
      const adminIds = admins.map((a) => a.id);

      await this.prisma.$transaction(async (tx) => {
        // Атомарный дедуп между параллельными инстансами.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

        // Дедуп — ПЕРСОНАЛЬНЫЙ, по каждому получателю отдельно.
        //
        // Раньше здесь был findFirst({ type, message, createdAt >= since }) без
        // userId: как только сообщение ушло ЛЮБОМУ админу, следующие алерты с
        // тем же текстом не доставлялись НИКОМУ в течение часа. Это давало два
        // реальных дефекта: (1) новый админ не получал текущий алерт вообще;
        // (2) сообщение обрезано до первых 5 нарушений (alertAdmins), поэтому
        // два разных инцидента с одинаковым префиксом склеивались в один, и
        // второй молча терялся. Здесь «нарушение есть — уведомления нет» —
        // ровно тот молчаливый пропуск, который метод обязан исключать.
        //
        // Теперь глушим только тех, кто уже получал ровно это сообщение.
        const already = await tx.notification.findMany({
          where: {
            type,
            message,
            userId: { in: adminIds },
            createdAt: { gte: since },
          },
          select: { userId: true },
        });
        const alreadySent = new Set(already.map((n) => n.userId));
        const pending = admins.filter((a) => !alreadySent.has(a.id));
        if (!pending.length) return;

        await Promise.all(
          pending.map((a) =>
            this.notifications
              .createNotification(a.id, type, message)
              .catch((err) =>
                this.logger.warn(
                  `admin notification to ${a.id} failed: ${err.message}`,
                ),
              ),
          ),
        );
      });
    } catch (err) {
      this.logger.error(
        `notifyAdminsSafely(${type}) failed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * D9 (superfluous): сверка реестра эскроу после транзакций, изменяющих
   * заказ. EscrowService ставит escrowStatus и пишет проводки в одной
   * транзакции, поэтому состояние сходится. Метод — для ручного/тестового
   * контроля: возвращает список заказов, где статус и наличие проводок
   * расходятся (кандидаты на разбор).
   */
  async findEscrowMismatches(
    limit = 100,
  ): Promise<
    Array<{ orderId: string; escrowStatus: EscrowStatus; ledgerEscrow: number }>
  > {
    const orders = await this.prisma.order.findMany({
      where: { escrowStatus: { not: EscrowStatus.NONE } },
      select: { id: true, escrowStatus: true },
      take: limit,
    });
    const out: Array<{
      orderId: string;
      escrowStatus: EscrowStatus;
      ledgerEscrow: number;
    }> = [];
    for (const o of orders) {
      const agg = await this.prisma.ledgerEntry.aggregate({
        where: { orderId: o.id, account: LedgerAccount.ESCROW },
        _sum: { amount: true },
      });
      const ledgerEscrow = round2(agg._sum.amount ?? 0);
      const shouldBeHeld = o.escrowStatus === EscrowStatus.HELD;
      const isHeldInLedger = ledgerEscrow > 0;
      if (shouldBeHeld !== isHeldInLedger) {
        out.push({ orderId: o.id, escrowStatus: o.escrowStatus, ledgerEscrow });
      }
    }
    return out;
  }

  // ============================================================
  // Внутреннее
  // ============================================================

  private validateOps(ops: LedgerOp[]): void {
    const seen = new Set<string>();
    for (const op of ops) {
      if (!op.refKey) {
        throw new LedgerInvariantError('apply: refKey is required');
      }
      if (seen.has(op.refKey)) {
        throw new LedgerInvariantError(
          `apply: duplicate refKey in batch: ${op.refKey}`,
        );
      }
      seen.add(op.refKey);

      if (!Number.isFinite(op.amount)) {
        throw new LedgerInvariantError(
          `apply: amount must be finite (refKey=${op.refKey})`,
        );
      }
      if (op.account !== LedgerAccount.PLATFORM && !op.userId) {
        // ESCROW без userId допустим (агрегатный аккаунт заказа),
        // AVAILABLE/REFERRAL — обязаны быть привязаны к пользователю.
        if (
          op.account === LedgerAccount.AVAILABLE ||
          op.account === LedgerAccount.REFERRAL
        ) {
          throw new LedgerInvariantError(
            `apply: ${op.account} entry requires userId (refKey=${op.refKey})`,
          );
        }
      }
    }
  }

  /**
   * Запись проводок с защитой от дублей по refKey.
   * createMany({ skipDuplicates: true }) — единственный атомарный способ
   * сделать «insert if not exists» одним запросом.
   *
   * Журнал append-only: строка проводки создаётся ОДИН раз и больше не
   * меняется. Поэтому `balanceAfter` считается ДО вставки и пишется в ту же
   * строку (projectBalances), а не догоняется отдельным UPDATE после неё.
   * Дедуп-набор тоже определяется заранее — он нужен и для расчёта баланса.
   */
  private async applyInTx(
    tx: LedgerTx,
    ops: LedgerOp[],
    idempotent: boolean,
  ): Promise<LedgerApplyResult> {
    const existing = idempotent
      ? new Set(
          await this.findExistingRefKeys(
            tx,
            ops.map((op) => op.refKey),
          ),
        )
      : new Set<string>();

    const appliedOps = ops.filter((op) => !existing.has(op.refKey));
    const skipped = ops
      .filter((op) => existing.has(op.refKey))
      .map((op) => op.refKey);

    if (appliedOps.length) {
      // balanceAfter — кэш баланса аккаунта после операции (для аудита UI).
      // Считается по состоянию журнала ДО вставки + накопление внутри батча.
      const projected = await this.projectBalances(tx, appliedOps);

      const data: Prisma.LedgerEntryCreateManyInput[] = appliedOps.map(
        (op) => ({
          account: op.account,
          amount: round2(op.amount),
          type: op.type,
          refKey: op.refKey,
          userId: op.userId ?? null,
          orderId: op.orderId ?? null,
          dealId: op.dealId ?? null,
          currency: op.currency ?? 'USDT',
          balanceAfter: projected.get(op.refKey) ?? null,
          meta: (op.meta ?? undefined) as Prisma.InputJsonValue | undefined,
        }),
      );

      const result = await tx.ledgerEntry.createMany({
        data,
        skipDuplicates: idempotent,
      });

      if (result.count !== appliedOps.length) {
        if (!idempotent) {
          throw new LedgerInvariantError(
            `apply: expected ${appliedOps.length} entries, wrote ${result.count}`,
          );
        }
        // Гонка: параллельный писатель вставил тот же refKey между нашим
        // SELECT и INSERT. Проводка не записана — её balanceAfter не в счёт.
        this.logger.warn(
          `apply: ${appliedOps.length - result.count} refKey(s) skipped by concurrent writer`,
        );
      }
    }

    const applied = appliedOps.map((op) => op.refKey);

    if (applied.length) {
      await this.updateBalanceCache(tx, applied);
    }

    if (skipped.length) {
      this.logger.debug(
        `Ledger idempotency: skipped ${skipped.length} duplicate refKey(s)`,
      );
    }

    return { applied, skipped };
  }

  /**
   * Предрасчёт `balanceAfter` для пачки проводок (append-only журнал).
   *
   * Базы отсчёта — ровно те же, что в updateBalanceCache:
   *   AVAILABLE — сумма проводок журнала (источник истины, §4.1);
   *   REFERRAL  — кэш `User.bonusBalance`, потому что в нём сидит легаси-сид,
   *               которого в журнале нет: перезапись суммой журнала обнулила
   *               бы пользовательские деньги (§1.3.3 ТЗ).
   * Для нескольких проводок одного пользователя баланс накапливается в
   * порядке следования ops (running), по каждому аккаунту отдельно.
   */
  private async projectBalances(
    tx: LedgerTx,
    ops: LedgerOp[],
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const userIds = [
      ...new Set(
        ops
          .filter(
            (op) =>
              op.userId &&
              (op.account === LedgerAccount.AVAILABLE ||
                op.account === LedgerAccount.REFERRAL),
          )
          .map((op) => op.userId as string),
      ),
    ];
    if (!userIds.length) return out;

    const [availableAgg, users] = await Promise.all([
      tx.ledgerEntry.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds }, account: LedgerAccount.AVAILABLE },
        _sum: { amount: true },
      }),
      tx.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, bonusBalance: true },
      }),
    ]);

    const availableBefore = new Map(
      availableAgg.map((r) => [r.userId, round2(r._sum.amount ?? 0)]),
    );
    const bonusBefore = new Map(
      users.map((u) => [u.id, round2(u.bonusBalance ?? 0)]),
    );

    const running = new Map<string, number>();
    for (const op of ops) {
      if (!op.userId) continue;
      if (
        op.account !== LedgerAccount.AVAILABLE &&
        op.account !== LedgerAccount.REFERRAL
      ) {
        continue;
      }
      const key = `${op.userId}:${op.account}`;
      const base =
        op.account === LedgerAccount.AVAILABLE
          ? (availableBefore.get(op.userId) ?? 0)
          : (bonusBefore.get(op.userId) ?? 0);
      const next = round2((running.get(key) ?? base) + round2(op.amount));
      running.set(key, next);
      out.set(op.refKey, next);
    }

    return out;
  }

  private async findExistingRefKeys(
    tx: LedgerTx,
    refKeys: string[],
  ): Promise<string[]> {
    const rows = await tx.ledgerEntry.findMany({
      where: { refKey: { in: refKeys } },
      select: { refKey: true },
    });
    return rows.map((r) => r.refKey);
  }

  /**
   * Обновить кэши балансов: `User.availableBalance` / `User.bonusBalance`.
   *
   * `LedgerEntry.balanceAfter` здесь БОЛЬШЕ НЕ ОБНОВЛЯЕТСЯ (ФИКС 3).
   * Прежний `ledgerEntry.update({ data: { balanceAfter } })` нарушал
   * append-only-принцип журнала: строка проводки переписывалась спустя время.
   * Значение пишется сразу при `create` (см. applyInTx/projectBalances).
   * Никто, кроме этого метода, журнал не мутировал, значит после правки
   * LedgerEntry — строго append-only по ВСЕМ полям, включая денежные
   * (`amount`, `account`, `userId`, `refKey`, `type`), которые не
   * обновлялись и раньше.
   *
   * availableBalance — производная от журнала: пересчитываем из суммы
   * AVAILABLE-проводок (инкремент разъехался бы при пропущенной проводке).
   *
   * bonusBalance — ИНКРЕМЕНТ на дельту только что записанных REFERRAL-
   * проводок, а НЕ перезапись суммой по журналу (§1.3.3 ТЗ). Причина:
   * легаси-сид (бонус, выданный до введения LedgerEntry) журнала не имеет,
   * и перезапись затирала бы его первой же операцией (сид 500 + бонус 10 →
   * 10 вместо 510). Обнуление пользовательских денег ТЗ прямо запрещает.
   * Инкремент безопасен: updateBalanceCache вызывается только для реально
   * записанных refKey, а идемпотентность держит unique-констрейнт.
   */
  private async updateBalanceCache(
    tx: LedgerTx,
    refKeys: string[],
  ): Promise<void> {
    const entries = await tx.ledgerEntry.findMany({
      where: { refKey: { in: refKeys } },
    });

    const userIds = new Set<string>();
    for (const entry of entries) {
      if (
        entry.userId &&
        (entry.account === LedgerAccount.AVAILABLE ||
          entry.account === LedgerAccount.REFERRAL)
      ) {
        userIds.add(entry.userId);
      }
    }

    for (const userId of userIds) {
      const available = await tx.ledgerEntry.aggregate({
        where: { userId, account: LedgerAccount.AVAILABLE },
        _sum: { amount: true },
      });

      // Дельта бонусов = сумма REFERRAL-проводок из этого батча (только что
      // записанных). Легаси-сид не трогаем — он остаётся в кэше.
      const referralDelta = round2(
        entries
          .filter(
            (e) => e.userId === userId && e.account === LedgerAccount.REFERRAL,
          )
          .reduce((acc, e) => acc + e.amount, 0),
      );

      await tx.user.update({
        where: { id: userId },
        data: {
          availableBalance: round2(available._sum.amount ?? 0),
          ...(referralDelta !== 0
            ? { bonusBalance: { increment: referralDelta } }
            : {}),
        },
      });
    }
  }
}
