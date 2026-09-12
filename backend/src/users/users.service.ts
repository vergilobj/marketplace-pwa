import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { PaymodService } from '../payments/paymod.service';
import { LedgerService } from '../payments/ledger.service';
import { LedgerApplyResult } from '../payments/dto/ledger.dto';
import { round2, toRaw } from '../payments/money.util';
import { LedgerAccount, Prisma, UserRole } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import {
  PAGINATION_BULK_LIMIT,
  clampLimit,
  clampPage,
} from '../common/dto/pagination.dto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private notificationsService: NotificationsService,
    private paymodService: PaymodService,
    private settings: SettingsService,
    private ledger: LedgerService,
  ) {}

  async findById(id: string, select?: Prisma.UserSelect) {
    return this.prisma.user.findUnique({ where: { id }, select });
  }

  async findByPhone(phone: string) {
    return this.prisma.user.findUnique({ where: { phone } });
  }

  async findAll(params: { page?: number; limit?: number; search?: string }) {
    const page = clampPage(params.page, 1);
    const limit = clampLimit(params.limit, 20);
    const skip = (page - 1) * limit;
    const where: Prisma.UserWhereInput = {};
    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: 'insensitive' } },
        { phone: { contains: params.search, mode: 'insensitive' } },
      ];
    }
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          phone: true,
          name: true,
          role: true,
          isApproved: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total, page, pages: Math.ceil(total / limit) };
  }

  async updateProfile(userId: string, dto: UpdateUserDto) {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: dto,
    });
    await this.auditService.log({
      userId,
      action: 'profile_updated',
      entity: 'user',
      entityId: userId,
    });
    return updated;
  }

  /**
   * L1: рефералы пользователя. Раньше `findMany` без `take`.
   * ⚠️ Фронт (`ReferralsPage`) читает ответ как МАССИВ (`Array.isArray(r)`).
   * Форму не меняем, только ограничиваем длину. Дефолт 100.
   */
  async getReferrals(
    userId: string,
    params: { page?: number; limit?: number } = {},
  ) {
    const page = clampPage(params.page, 1);
    const limit = clampLimit(params.limit, PAGINATION_BULK_LIMIT);
    return this.prisma.order.findMany({
      where: { referralUserId: userId },
      include: {
        buyer: { select: { id: true, name: true } },
        product: { select: { title: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    });
  }

  async exportUsers() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        phone: true,
        name: true,
        role: true,
        isApproved: true,
        referralCode: true,
        bonusBalance: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Начисление реферального бонуса + внутренняя Notification + push (graceful).
   * §4.2: бонус начисляется при релизе эскроу, а не при депозите — иначе при
   * возврате пришлось бы откатывать уже выданное. Проводка идёт через
   * LedgerService (account=REFERRAL), кэш bonusBalance пересчитывается там же.
   */
  async creditReferralBonus(userId: string, amount: number, orderId: string) {
    await this.ledger.credit(null, {
      userId,
      account: LedgerAccount.REFERRAL,
      amount,
      type: 'referral_bonus',
      refKey: `referral_bonus:order:${orderId}`,
      orderId,
    });

    await this.notificationsService.createNotification(
      userId,
      'referral',
      `Начислен реферальный бонус: ${amount} USDT`,
      orderId,
    );

    try {
      await this.notificationsService.sendToUser(
        userId,
        { en: 'Реферальный бонус' },
        { en: `Начислен реферальный бонус: ${amount} USDT` },
        { screen: 'balance' },
      );
    } catch (err) {
      this.logger.warn(`Referral push for ${userId} failed: ${err.message}`);
    }
  }

  // ====== Статистика ======
  /**
   * §8.2: статистика профиля.
   *
   * soldEarned — сколько продавец реально заработал (зачислено на
   * AVAILABLE-аккаунт журнала). Считаем только ПОЛОЖИТЕЛЬНЫЕ проводки:
   * выводы и откаты идут отрицательными и выручку не уменьшают —
   * «заработано за всё время» не должно проседать после вывода средств.
   */
  async getStats(userId: string) {
    const [boughtCount, soldCount, referralOrders, balanceUser, soldAgg] =
      await Promise.all([
        this.prisma.order.count({ where: { buyerId: userId } }),
        this.prisma.order.count({ where: { sellerId: userId } }),
        this.prisma.order.aggregate({
          where: { referralUserId: userId },
          _sum: { referralBonus: true },
        }),
        this.prisma.user.findUnique({
          where: { id: userId },
          select: { bonusBalance: true },
        }),
        this.prisma.ledgerEntry.aggregate({
          where: {
            userId,
            account: LedgerAccount.AVAILABLE,
            amount: { gt: 0 },
          },
          _sum: { amount: true },
        }),
      ]);

    return {
      boughtCount,
      soldCount,
      referralEarned: referralOrders._sum.referralBonus || 0,
      bonusBalance: balanceUser?.bonusBalance || 0,
      // §8.2: сумма зачислений продавцу (escrow_release → AVAILABLE).
      soldEarned: round2(soldAgg._sum.amount ?? 0),
    };
  }

  async getBalance(userId: string) {
    // §4.6: единый формат — выводимая выручка, бонусы, замороженный эскроу.
    const balances = await this.ledger.getBalances(userId);
    const user = await this.findById(userId, {
      availableBalance: true,
      bonusBalance: true,
    });
    return {
      availableBalance: balances.availableBalance,
      bonusBalance: balances.bonusBalance,
      pendingEscrow: balances.pendingEscrow,
      totalWithdrawable: balances.totalWithdrawable,
      // Обратная совместимость со старым фронтом (balance = бонусы).
      balance: user?.bonusBalance ?? balances.bonusBalance,
    };
  }

  /**
   * §8.2: история операций пользователя (GET /users/me/ledger).
   * Курсорная пагинация по id последней записи (createdAt desc).
   * Возвращает { items, nextCursor } — nextCursor = null на последней странице.
   */
  async getLedger(
    userId: string,
    params: { limit?: number; cursor?: string } = {},
  ) {
    const take = Math.min(Math.max(params.limit ?? 20, 1), 100);

    const rows = await this.prisma.ledgerEntry.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;

    return {
      items,
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  /** §5.2: вывод разрешён из availableBalance + bonusBalance за вычетом pending. */
  async requestWithdrawal(userId: string, amount: number, toAddress?: string) {
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('Пользователь не найден');
    if (!(amount > 0)) throw new BadRequestException('Amount must be positive');

    const minAmount = await this.settings.getFloat('withdrawal_min_amount');
    const min = minAmount > 0 ? minAmount : 10;
    if (amount < min) {
      throw new BadRequestException(`Минимальная сумма вывода — ${min} USDT`);
    }

    // Валидация BSC-адреса: 0x + 40 hex.
    if (toAddress !== undefined && toAddress !== null && toAddress !== '') {
      const trimmed = toAddress.trim();
      if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
        throw new BadRequestException(
          'Invalid BSC wallet address (expected 0x + 40 hex)',
        );
      }
      toAddress = trimmed;
    }

    const pendingRequests = await this.prisma.withdrawalRequest.findMany({
      where: { userId, status: 'pending' },
    });
    const totalPending = pendingRequests.reduce((sum, r) => sum + r.amount, 0);
    const balances = await this.ledger.getBalances(userId);
    const available = round2(balances.totalWithdrawable - totalPending);
    if (available < amount)
      throw new BadRequestException(
        `Insufficient balance. Available: ${available} USDT`,
      );

    // Сохраняем адрес вывода и на юзере (если передан) — удобно для следующих выводов.
    if (toAddress) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { walletAddress: toAddress },
      });
    }

    return this.prisma.withdrawalRequest.create({
      data: {
        userId,
        amount: round2(amount),
        status: 'pending',
        toAddress: toAddress ?? null,
        provider: 'PAYMOD',
      },
    });
  }

  /**
   * L1: выводы пользователя. Раньше `findMany` без `take`.
   * ⚠️ Фронт (`WithdrawalsPage`) читает ответ как МАССИВ и считает сумму
   * pending по всему списку. Форму не меняем; дефолт 100 — заявок на вывод
   * у одного юзера столько практически не бывает, а сумма pending считается
   * по последним 100, что для лимита вывода безопасно.
   */
  async getMyWithdrawalRequests(
    userId: string,
    params: { page?: number; limit?: number } = {},
  ) {
    const page = clampPage(params.page, 1);
    const limit = clampLimit(params.limit, PAGINATION_BULK_LIMIT);
    return this.prisma.withdrawalRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    });
  }

  /**
   * L1: все выводы для админки. Раньше `findMany` без `take` — на большом
   * количестве заявок админка тянула всю таблицу. Форму (массив) сохраняем.
   * Дефолт 100.
   */
  async getAllWithdrawalRequests(
    params: { page?: number; limit?: number } = {},
  ) {
    const page = clampPage(params.page, 1);
    const limit = clampLimit(params.limit, PAGINATION_BULK_LIMIT);
    return this.prisma.withdrawalRequest.findMany({
      include: { user: { select: { id: true, name: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    });
  }

  /**
   * §5.2: одобрение вывода.
   *
   * Ключевые исправления относительно старого кода:
   *   1. Проверка адреса — ДО списания (раньше падало после списания → деньги
   *      исчезали);
   *   2. Списание через LedgerService.debit с приоритетом AVAILABLE→REFERRAL
   *      (а не decrement bonusBalance);
   *   3. При FAILED payout — компенсирующие проводки (reversal), заявка
   *      возвращается в pending (retryable), payoutAttempts++.
   */
  async approveWithdrawal(requestId: string) {
    const request = await this.prisma.withdrawalRequest.findUnique({
      where: { id: requestId },
    });
    if (!request || request.status !== 'pending')
      throw new BadRequestException('Invalid request');

    const user = await this.findById(request.userId);
    if (!user) throw new BadRequestException('Пользователь не найден');

    // 1. АДРЕС — проверяем ДО списания (это был баг).
    const toAddress = request.toAddress || user.walletAddress;
    if (!toAddress || !/^0x[0-9a-fA-F]{40}$/.test(toAddress)) {
      await this.prisma.withdrawalRequest.update({
        where: { id: requestId },
        data: {
          payoutStatus: 'FAILED',
          payoutError: 'No valid wallet address',
        },
      });
      throw new BadRequestException('No valid wallet address for payout');
    }

    // Баланс с приоритетом AVAILABLE, затем REFERRAL (§5.2 шаг 2).
    const balances = await this.ledger.getBalances(request.userId);
    const available = balances.availableBalance;
    const referral = balances.bonusBalance;
    if (round2(available + referral) < request.amount) {
      throw new BadRequestException('Insufficient balance');
    }

    const attempt = (request.payoutAttempts ?? 0) + 1;
    const idempotencyKey = uuidv4();
    const fromAvailable = Math.min(round2(available), request.amount);
    const fromReferral = round2(request.amount - fromAvailable);

    // NH1: refKey дебета ОБЯЗАН включать номер попытки — ровно как у
    // компенсирующей проводки. Без номера повторное одобрение после
    // reversal пишет проводку с УЖЕ существующим refKey, а
    // LedgerService.apply({idempotent:true}) молча пропускает дубль
    // (createMany skipDuplicates, count не проверяется). Баланс не
    // уменьшается, исключения нет — код уходит платить в сеть.
    // Итог: пользователь получает деньги в сеть И сохраняет их на балансе.
    const debits: Array<{
      account: LedgerAccount;
      amount: number;
      refKey: string;
    }> = [];
    if (fromAvailable > 0) {
      debits.push({
        account: LedgerAccount.AVAILABLE,
        amount: fromAvailable,
        refKey: `withdrawal_debit:${requestId}:${attempt}:AVAILABLE`,
      });
    }
    if (fromReferral > 0) {
      debits.push({
        account: LedgerAccount.REFERRAL,
        amount: fromReferral,
        refKey: `withdrawal_debit:${requestId}:${attempt}:REFERRAL`,
      });
    }

    // 2. $transaction: списание + статус approved.
    // Возвращаем результат каждой проводки — вторая линия защиты NH1.
    const debitResults = await this.prisma.$transaction(async (tx) => {
      const results: LedgerApplyResult[] = [];
      for (const d of debits) {
        results.push(
          await this.ledger.debit(tx, {
            userId: request.userId,
            account: d.account,
            amount: d.amount,
            type: 'withdrawal_debit',
            refKey: d.refKey,
          }),
        );
      }
      await tx.withdrawalRequest.update({
        where: { id: requestId },
        data: {
          status: 'approved',
          idempotencyKey,
          payoutAttempts: attempt,
        },
      });
      return results;
    });

    // NH1 (вторая линия защиты): если хоть одна проводка не записалась
    // (пришла как skipped — коллизия refKey), баланс НЕ уменьшен.
    // Платить в сеть в этом состоянии нельзя: деньги создаются из воздуха.
    // Откатываем заявку в pending, чтобы админ повторил (следующая попытка
    // получит новый номер в refKey). Реверс НЕ делаем — списания не было.
    const allDebitsApplied = debitResults.every(
      (r) => r.applied.length === 1 && r.skipped.length === 0,
    );
    if (!allDebitsApplied) {
      this.logger.error(
        `ALERT withdrawal ${requestId} attempt ${attempt}: ledger debit not applied ` +
          `(duplicate refKey) — payout ABORTED, funds NOT sent`,
      );
      await this.prisma.withdrawalRequest.update({
        where: { id: requestId },
        data: {
          status: 'pending',
          payoutStatus: 'FAILED',
          payoutError:
            'ledger debit not applied (duplicate refKey), payout aborted',
        },
      });
      throw new BadRequestException(
        'Списание не применилось (дубль проводки) — выплата отменена',
      );
    }

    // 3. ВНЕ транзакции: выплата в сеть.
    const amountRaw = toRaw(request.amount, 18);
    try {
      const result = await this.paymodService.payout({
        idempotency_key: idempotencyKey,
        client_ref: `mp-withdrawal-${request.id}-${attempt}`,
        to_address: toAddress,
        amount: amountRaw,
        token: 'USDT',
        chain: 'bsc',
      });

      const failed = result.status?.toLowerCase() === 'failed';
      if (failed) {
        // Провайдер ответил «failed» без throw — тот же откат, что и в catch.
        await this.reverseWithdrawal(requestId, request.userId, attempt, {
          fromAvailable,
          fromReferral,
        });
        return this.prisma.withdrawalRequest.findUniqueOrThrow({
          where: { id: requestId },
        });
      }

      this.logger.log(
        `Withdrawal ${request.id} payout submitted: tx=${result.tx_hash} status=${result.status}`,
      );

      return this.prisma.withdrawalRequest.update({
        where: { id: requestId },
        data: {
          payoutTxHash: result.tx_hash ?? undefined,
          payoutStatus: 'SUBMITTED',
          payoutError: result.error ?? null,
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // D3 (остаток): ответ paymod мог ПОТЕРЯТЬСЯ (таймаут/5xx/рестарт), а
      // выплата при этом реально ушла в сеть. Раньше catch слепо делал
      // reversal: админ одобрял повторно, idempotencyKey и client_ref были
      // НОВЫМИ → paymod считал это новой выплатой → второй on-chain перевод.
      //
      // Перед откатом спрашиваем тот же idempotencyKey. Sidecar хранит
      // выплату до отправки и идемпотентен по этому ключу: если транзакция
      // ушла, повторный вызов вернёт её tx_hash со status submitted
      // (replayed=true). В этом случае НЕ откатываем — фиксируем SUBMITTED,
      // деньги списаны и отправлены.
      const recovered = await this.recoverPayout(idempotencyKey);
      if (recovered) {
        this.logger.warn(
          `Withdrawal ${requestId} attempt ${attempt}: payout response was lost, ` +
            `but tx ${recovered.tx_hash} is on-chain — NOT reversing`,
        );
        return this.prisma.withdrawalRequest.update({
          where: { id: requestId },
          data: {
            payoutTxHash: recovered.tx_hash ?? undefined,
            payoutStatus: 'SUBMITTED',
            payoutError: `response lost, recovered via idempotency_key: ${msg}`,
          },
        });
      }

      // 4b. ОШИБКА: компенсация + возврат заявки в pending (retryable).
      await this.reverseWithdrawal(requestId, request.userId, attempt, {
        fromAvailable,
        fromReferral,
      });
      await this.notifySafely(
        request.userId,
        'withdrawal',
        'Выплата не удалась, средства возвращены на баланс.',
      );
      // НЕ throw: админ должен видеть состояние заявки, а не 500.
      return this.prisma.withdrawalRequest.findUniqueOrThrow({
        where: { id: requestId },
      });
    }
  }

  /**
   * D3 (остаток): восстановление результата выплаты по idempotency_key.
   *
   * Возвращает { tx_hash, status } если sidecar подтверждает, что выплата
   * ушла в сеть (status submitted/confirmed/swept с непустым tx_hash).
   * null — выплаты нет (ключ неизвестен или запись в failed) → откат безопасен.
   *
   * Использует READ-ONLY GET /v1/payout/{key}. Важно: POST /v1/payout для
   * НЕИЗВЕСТНОГО ключа реально инициирует перевод, поэтому «спрашивать»
   * им состояние нельзя — создашь вторую выплату с нулевой суммой.
   *
   * При недоступности sidecar (сеть/5xx) бросаем BadRequestException:
   * откатывать вслепую нельзя — если выплата ушла, reversal вернёт деньги
   * на баланс, а админ позже сделает второй перевод с новым ключом.
   * Заявка останется approved/SUBMITTED-незавершённой, её разберёт
   * reconcilePayouts по payoutTxHash.
   */
  private async recoverPayout(
    idempotencyKey: string,
  ): Promise<{ tx_hash: string | null; status: string } | null> {
    try {
      const existing = await this.paymodService.getPayout(idempotencyKey);
      if (!existing) return null; // ключа нет — выплаты не было
      const status = (existing.status || '').toLowerCase();
      if (status === 'failed' || status === 'error') return null; // выплата не ушла
      // submitted/confirmed/swept/pending — выплата инициирована.
      return { tx_hash: existing.tx_hash ?? null, status };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(
        `recoverPayout(${idempotencyKey}) failed: ${msg} — ` +
          `cannot confirm payout state, refusing blind reversal`,
      );
      throw new BadRequestException(
        `Не удалось подтвердить состояние выплаты: ${msg}`,
      );
    }
  }

  /**
   * Компенсация неудачной выплаты (§5.2 шаг 4b).
   * refKey включает номер попытки — повторный откат по новой попытке
   * возможен без конфликта по unique.
   */
  private async reverseWithdrawal(
    requestId: string,
    userId: string,
    attempt: number,
    parts: { fromAvailable: number; fromReferral: number },
  ): Promise<void> {
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
          payoutError: 'payout failed, funds reversed',
        },
      });
    });
  }

  private async notifySafely(
    userId: string,
    type: string,
    message: string,
    relatedId?: string,
  ) {
    try {
      await this.notificationsService.createNotification(
        userId,
        type,
        message,
        relatedId,
      );
    } catch (err) {
      this.logger.warn(`Notification to ${userId} failed: ${err.message}`);
    }
  }

  async rejectWithdrawal(requestId: string) {
    const request = await this.prisma.withdrawalRequest.findUnique({
      where: { id: requestId },
    });
    if (!request || request.status !== 'pending')
      throw new Error('Invalid request');
    return this.prisma.withdrawalRequest.update({
      where: { id: requestId },
      data: { status: 'rejected' },
    });
  }

  // ================== A4: заявка «Стать продавцом» ==================

  /** Уведомить всех админов (внутреннее уведомление в БД). Ошибки не валят флоу. */
  private async notifyAdmins(
    type: string,
    message: string,
    relatedId?: string,
  ) {
    try {
      const admins = await this.prisma.user.findMany({
        where: { role: UserRole.ADMIN },
        select: { id: true },
      });
      await Promise.all(
        admins.map((a) =>
          this.notificationsService.createNotification(
            a.id,
            type,
            message,
            relatedId,
          ),
        ),
      );
    } catch (err) {
      this.logger.warn(`notifyAdmins failed: ${err.message}`);
    }
  }

  /**
   * A4: создать заявку на продавца. Роль НЕ меняется — ждёт модерации админа.
   * Повторная подача после REJECTED разрешена (заявка переоткрывается).
   */
  async createSellerRequest(userId: string) {
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('Пользователь не найден');

    if (user.role !== UserRole.BUYER) {
      // Уже продавец/админ — заявка не нужна, роль не понижаем.
      return { status: 'APPROVED', alreadySeller: true };
    }

    const existing = await this.prisma.sellerRequest.findUnique({
      where: { userId },
    });
    if (existing?.status === 'PENDING') {
      throw new BadRequestException('Заявка уже на рассмотрении');
    }

    const request = existing
      ? await this.prisma.sellerRequest.update({
          where: { userId },
          data: {
            status: 'PENDING',
            note: null,
            reviewedAt: null,
            reviewedBy: null,
            createdAt: new Date(),
          },
        })
      : await this.prisma.sellerRequest.create({ data: { userId } });

    await this.auditService.log({
      userId,
      action: 'seller_request_created',
      entity: 'seller_request',
      entityId: request.id,
    });

    await this.notifyAdmins(
      'seller_request',
      `Новая заявка на продавца: ${user.name || user.phone}`,
      request.id,
    );

    return request;
  }

  /** A4: своя заявка (для профиля). null — заявки не было. */
  async getMySellerRequest(userId: string) {
    const request = await this.prisma.sellerRequest.findUnique({
      where: { userId },
    });
    if (!request) return { status: null };
    return request;
  }

  /**
   * A4: список заявок для админки (опционально фильтр по статусу).
   * L1: раньше `findMany` без `take` — все заявки разом. Форму (массив)
   * сохраняем: админка (`AdminPage`) читает ответ как список. Дефолт 100.
   */
  async getSellerRequests(
    status?: string,
    params: { page?: number; limit?: number } = {},
  ) {
    const page = clampPage(params.page, 1);
    const limit = clampLimit(params.limit, PAGINATION_BULK_LIMIT);
    return this.prisma.sellerRequest.findMany({
      where: status ? { status } : undefined,
      include: {
        user: {
          select: { id: true, name: true, phone: true, role: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    });
  }

  /**
   * A4: решение админа по заявке.
   * APPROVED → роль BUYER становится SELLER + уведомление юзеру.
   * REJECTED → роль не меняется, юзер может подать заново.
   */
  async reviewSellerRequest(
    id: string,
    adminId: string,
    approve: boolean,
    note?: string,
  ) {
    const request = await this.prisma.sellerRequest.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!request) throw new NotFoundException('Заявка не найдена');
    if (request.status !== 'PENDING') {
      throw new BadRequestException('Заявка уже рассмотрена');
    }

    const status = approve ? 'APPROVED' : 'REJECTED';
    const updated = await this.prisma.sellerRequest.update({
      where: { id },
      data: {
        status,
        note: note || null,
        reviewedAt: new Date(),
        reviewedBy: adminId,
      },
    });

    if (approve && request.user.role === UserRole.BUYER) {
      await this.prisma.user.update({
        where: { id: request.userId },
        data: { role: UserRole.SELLER },
      });
    }

    await this.auditService.log({
      userId: adminId,
      action: approve ? 'seller_request_approved' : 'seller_request_rejected',
      entity: 'seller_request',
      entityId: id,
      metadata: { applicantId: request.userId, note: note || null },
    });

    await this.notifySafely(
      request.userId,
      'seller_request',
      approve
        ? 'Заявка на продавца одобрена — теперь вы можете продавать'
        : `Заявка на продавца отклонена${note ? `: ${note}` : ''}`,
      id,
    );

    return updated;
  }

  /**
   * Смена роли BUYER → SELLER. A4: только если заявка одобрена админом.
   * SELLER/ADMIN не понижаем — возвращаем как есть (идемпотентно).
   */
  async becomeSeller(userId: string) {
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('Пользователь не найден');

    if (user.role !== UserRole.BUYER) {
      const { passwordHash: _ph, ...rest } = user;
      return rest;
    }

    const request = await this.prisma.sellerRequest.findUnique({
      where: { userId },
    });
    if (!request || request.status !== 'APPROVED') {
      throw new BadRequestException(
        'Сначала подайте заявку и дождитесь одобрения админа',
      );
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { role: UserRole.SELLER },
    });

    await this.auditService.log({
      userId,
      action: 'become_seller',
      entity: 'user',
      entityId: userId,
    });

    const { passwordHash: _ph2, ...rest } = updated;
    return rest;
  }

  async changeRole(userId: string, newRole: UserRole) {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { role: newRole },
    });
    await this.auditService.log({
      action: 'role_changed',
      entity: 'user',
      entityId: userId,
    });
    return updated;
  }

  async batchChangeRole(userIds: string[], newRole: UserRole) {
    const result = await this.prisma.user.updateMany({
      where: { id: { in: userIds } },
      data: { role: newRole },
    });
    await this.auditService.log({
      action: 'batch_role',
      entity: 'user',
      metadata: { userIds, newRole, count: result.count },
    });
    return result;
  }

  async batchApprove(userIds: string[]) {
    const result = await this.prisma.user.updateMany({
      where: { id: { in: userIds }, isApproved: false },
      data: { isApproved: true },
    });
    await this.auditService.log({
      action: 'batch_approve',
      entity: 'user',
      metadata: { userIds, count: result.count },
    });
    return result;
  }
}
