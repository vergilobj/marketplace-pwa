import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  EscrowStatus,
  LedgerAccount,
  OrderStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LedgerService } from './ledger.service';
import {
  LedgerApplyResult,
  LedgerInvariantError,
  LedgerOp,
} from './dto/ledger.dto';
import { addDays, round2 } from './money.util';

export type EscrowCloseReason =
  | 'buyer_confirmed'
  | 'auto_timeout'
  | 'arbitration'
  | 'seller_no_ship_timeout'
  | 'arbitration_buyer_right'
  | 'arbitration_split'
  | 'deal_cancelled'
  | 'admin_refund'
  // NH9 (КРИТ): закрытие эскроу РЕКЛАМНОГО заказа в пользу платформы.
  // Услуга оказана (объявление показывается), возвращать нечего.
  | 'settle_ad_sale';

export interface EscrowHoldResult {
  held: boolean;
  amount: number;
  escrowStatus: EscrowStatus;
  autoCompleteAt: Date | null;
}

export interface EscrowReleaseResult {
  released: boolean;
  amount: number;
  platformFee: number;
  sellerNet: number;
  referralBonus: number;
  reason: EscrowCloseReason;
  /**
   * NH10: объявление погашено этим закрытием. Для рекламного заказа `true`,
   * когда платформа удержала плату за показ или рекламодателю вернулись
   * деньги за неотработанные дни.
   */
  postClosed: boolean;
}

export interface EscrowRefundResult {
  refunded: boolean;
  escrowAmount: number;
  toBuyer: number;
  toSeller: number;
  feeCut: number;
  buyerSharePct: number;
  reason: EscrowCloseReason;
  /**
   * NH10: объявление погашено этим возвратом. Для рекламного заказа всегда
   * `true` — иначе после возврата денег объявление продолжало бы висеть в
   * ленте бесплатно до `adExpireDate` (дыра NH10: арбитраж/admin-возврат).
   */
  postClosed: boolean;
}

/**
 * EscrowService — жизненный цикл замороженных денег заказа (§4 ТЗ).
 *
 * Источник истины по деньгам — LedgerEntry. Order.escrowAmount/escrowStatus —
 * денормализованный кэш для быстрых чтений и агрегатов (§4.1).
 *
 * Идемпотентность держится на двух уровнях:
 *   1. updateMany-гард по escrowStatus внутри транзакции (защита от гонки
 *      между подтверждением покупателя, cron'ом и арбитражем);
 *   2. unique refKey в LedgerEntry (защита от повторной проводки).
 */
@Injectable()
export class EscrowService {
  private readonly logger = new Logger(EscrowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly notify: NotificationsService,
  ) {}

  // ============================================================
  // Холд (§4.2)
  // ============================================================

  /**
   * Заморозить деньги заказа после подтверждения депозита.
   * Вызывается из PaymentsService.processSuccessfulPayment.
   */
  async holdForOrder(orderId: string): Promise<EscrowHoldResult> {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        amount: true,
        status: true,
        escrowStatus: true,
      },
    });

    // Уже заморожен (повторный webhook) — выходим без побочных эффектов.
    if (order.escrowStatus === EscrowStatus.HELD) {
      return {
        held: false,
        amount: 0,
        escrowStatus: EscrowStatus.HELD,
        autoCompleteAt: null,
      };
    }

    if (!(order.amount > 0)) {
      throw new Error(`holdForOrder: order ${orderId} has non-positive amount`);
    }

    const shipDays = await this.getIntSetting('escrow_ship_deadline_days', 5);
    const autoCompleteAt = addDays(new Date(), shipDays);

    const claimed = await this.prisma.$transaction(async (tx) => {
      // Атомарный гард: эскроу ставится только из NONE.
      // Гонка (два webhook'а / webhook + cron) решается здесь: второй
      // апдейт получает count = 0 и НЕ должен ничего рассылать.
      const guard = await tx.order.updateMany({
        where: { id: orderId, escrowStatus: EscrowStatus.NONE },
        data: {
          escrowStatus: EscrowStatus.HELD,
          escrowAmount: round2(order.amount),
          escrowHeldAt: new Date(),
          autoCompleteAt,
        },
      });
      if (guard.count === 0) return false;

      // ФИКС 4: холд — такая же денежная операция, как релиз и возврат.
      // Пропуск проводки по дублю refKey при уже выставленном HELD = в
      // журнале нет заморозки, а заказ считается оплаченным → ALERT + откат.
      this.assertLedgerApplied(
        await this.ledger.hold(tx, {
          orderId,
          userId: order.buyerId,
          amount: order.amount,
        }),
        'holdForOrder',
        orderId,
      );

      return true;
    });

    // Проиграли гонку — холд уже создан другим вызовом. Ни уведомлений,
    // ни повторной проводки: возвращаем фактическое состояние заказа.
    if (!claimed) {
      const fresh = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: {
          escrowStatus: true,
          escrowAmount: true,
          autoCompleteAt: true,
        },
      });
      return {
        held: false,
        amount: 0,
        escrowStatus: fresh?.escrowStatus ?? EscrowStatus.HELD,
        autoCompleteAt: fresh?.autoCompleteAt ?? null,
      };
    }

    await this.notifySafely(
      order.buyerId,
      'escrow_held',
      `Оплата подтверждена. ${round2(order.amount)} USDT в эскроу до получения товара.`,
      orderId,
    );
    await this.notifySafely(
      order.sellerId,
      'order_paid',
      `Заказ оплачен. Отправьте товар в течение ${shipDays} дн.`,
      orderId,
    );

    this.logger.log(`Escrow HELD for order ${orderId}: ${order.amount} USDT`);

    return {
      held: true,
      amount: round2(order.amount),
      escrowStatus: EscrowStatus.HELD,
      autoCompleteAt,
    };
  }

  // ============================================================
  // Релиз (§4.3)
  // ============================================================

  /**
   * Разморозить эскроу в пользу продавца: ESCROW -> PLATFORM + AVAILABLE
   * + REFERRAL. Идемпотентно: повторный вызов при escrowStatus != HELD
   * выходит без изменений.
   */
  async releaseEscrow(
    orderId: string,
    reason: EscrowCloseReason = 'buyer_confirmed',
  ): Promise<EscrowReleaseResult> {
    return this.settleRelease(orderId, reason, OrderStatus.COMPLETED);
  }

  /**
   * NH9 (КРИТ): закрыть эскроу РЕКЛАМНОГО заказа.
   *
   * Реклама — это УСЛУГА, и её продавец — платформа (`sellerId` = ADMIN,
   * `platformFee` = вся сумма). Поэтому «продавец не отгрузил товар →
   * вернуть покупателю всё» к рекламе неприменимо: отгружать нечего, показ
   * идёт. Прежнее поведение (`refundEscrow(...,100)`) отдавало рекламодателю
   * 100% денег на 5-й день, а объявление висело в ленте до `dto.days` —
   * до 25 дней бесплатного показа, убыток `ad_price × (days − 5)`.
   *
   * Здесь наоборот: эскроу закрывается в пользу платформы, а доля за
   * НЕотработанные дни показа возвращается рекламодателю (buyerId = он же
   * adOwner). Сколько дней показано — столько и оплачено; за остальные
   * деньги возвращаются, и ровно в этот момент объявление гасится
   * (`isPinned=false`), чтобы возвращённые дни не показывались бесплатно.
   *
   * Заказ НЕ переводится в COMPLETED: остаётся в статусе, из которого пришёл
   * таймаут (PAID). Повторный вызов cron — no-op по гарду escrowStatus.
   */
  async settleAdSale(
    orderId: string,
    reason: EscrowCloseReason = 'settle_ad_sale',
  ): Promise<EscrowReleaseResult> {
    return this.settleRelease(orderId, reason, null, true);
  }

  /**
   * Общее ядро release/settleAdSale.
   *
   * @param terminalStatus статус заказа при закрытии; `null` — не трогать
   *        статус (нужно рекламе, см. settleAdSale).
   * @param adSplit        рекламный режим: считать долю рекламодателя за
   *        неотработанные дни и уведомлять его как покупателя услуги.
   */
  private async settleRelease(
    orderId: string,
    reason: EscrowCloseReason,
    terminalStatus: OrderStatus | null,
    adSplit = false,
  ): Promise<EscrowReleaseResult> {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });

    const empty: EscrowReleaseResult = {
      released: false,
      amount: 0,
      platformFee: 0,
      sellerNet: 0,
      referralBonus: 0,
      reason,
      postClosed: false,
    };

    if (order.escrowStatus !== EscrowStatus.HELD) return empty;

    // NH10: объявление погашается ТОЛЬКО в adSplit-ветке (см. tx ниже).
    // Ошибка внутри транзакции откатит и её — флаг выставляется после успеха.
    let postClosed = false;

    const amount = round2(order.amount);
    const platformFee = round2(order.platformFee);
    const referralBonus =
      order.referralUserId && order.referralBonus > 0
        ? round2(order.referralBonus)
        : 0;
    // Разбивка по умолчанию (§7.4): комиссия — платформе, остальное — продавцу.
    const sellerNetBase = round2(amount - platformFee - referralBonus);
    let sellerNet = sellerNetBase;
    let platformCut = platformFee;
    let buyerRefund = 0;

    // NH9: рекламный заказ — продавец услуги и есть платформа, поэтому
    // «комиссия платформы» здесь = выручка за показ (platformFee = amount).
    // Долю за НЕотработанные дни возвращаем рекламодателю (buyerId = он же
    // adOwner), отработанные дни остаются платформе. Убытка нет: сколько
    // дней показано, столько и оплачено; сколько не показано — возвращено,
    // и ровно в этот момент объявление гасится (см. tx ниже), чтобы
    // возвращённые дни не показывались бесплатно.
    if (adSplit) {
      // Возврат не может превышать то, что реально удержано: выручку за
      // показ (platformFee) плюс долю продавца. Реферальный бонус не
      // трогаем — он не доход платформы и у рекламы всегда 0.
      const refundable = round2(amount - referralBonus);
      const { refund: wanted } = await this.adSettlement(order);
      buyerRefund = Math.max(0, Math.min(round2(wanted), refundable));

      // Возврат списывается сначала с выручки платформы, затем с доли
      // продавца — иначе AVAILABLE продавца ушёл бы в минус.
      const fromPlatform = Math.min(buyerRefund, platformFee);
      const fromSeller = Math.min(
        round2(buyerRefund - fromPlatform),
        sellerNetBase,
      );
      buyerRefund = round2(fromPlatform + fromSeller);
      platformCut = round2(platformFee - fromPlatform);
      sellerNet = round2(sellerNetBase - fromSeller);
    }

    const claimed = await this.prisma.$transaction(async (tx) => {
      const guard = await tx.order.updateMany({
        where: { id: orderId, escrowStatus: EscrowStatus.HELD },
        data: {
          escrowStatus: EscrowStatus.RELEASED,
          escrowClosedAt: new Date(),
          ...(terminalStatus
            ? {
                status: terminalStatus,
                completedAt: new Date(),
                autoCompleteAt: null,
              }
            : { autoCompleteAt: null }),
        },
      });
      if (guard.count === 0) return false;

      // NH9: рекламный заказ закрывается вместе с эскроу. Объявление гасим
      // всегда, когда платформа оставила себе хоть что-то за показ, либо
      // когда мы вернули деньги за неотработанные дни — иначе эти дни
      // показывались бы бесплатно. Если объявление вообще не активировалось
      // (платформа не оказала услугу), деньги ушли рекламодателю целиком и
      // гасить нечего.
      if (adSplit && (platformCut > 0 || buyerRefund > 0)) {
        await tx.post.updateMany({
          where: { orderId },
          data: { isPinned: false, adExpireDate: new Date() },
        });
        postClosed = true;
      }

      if (adSplit) {
        // Рекламный путь: три-четыре ноги (эскроу → платформа + возврат
        // рекламодателю [+ доля продавца]). Отдельный набор проводок нужен
        // потому, что ledger.release не умеет возврат покупателю, а
        // ledger.refund перевёл бы заказ в REFUNDED/SPLIT — для рекламы
        // неверно (заказ закрыт в пользу платформы, а не возвращён).
        const ops: LedgerOp[] = [
          {
            account: LedgerAccount.ESCROW,
            amount: -amount,
            type: 'escrow_release',
            refKey: `escrow_release:${orderId}:ESCROW`,
            userId: order.buyerId,
            orderId,
          },
          {
            account: LedgerAccount.PLATFORM,
            amount: platformCut,
            type: 'platform_fee',
            refKey: `escrow_release:${orderId}:PLATFORM`,
            userId: null,
            orderId,
          },
          {
            account: LedgerAccount.AVAILABLE,
            amount: buyerRefund,
            type: 'escrow_refund',
            refKey: `escrow_refund:${orderId}:AVAILABLE`,
            userId: order.buyerId,
            orderId,
          },
        ];
        if (sellerNet > 0) {
          ops.push({
            account: LedgerAccount.AVAILABLE,
            amount: sellerNet,
            type: 'escrow_release',
            refKey: `escrow_release:${orderId}:AVAILABLE`,
            userId: order.sellerId,
            orderId,
          });
        }
        if (referralBonus > 0 && order.referralUserId) {
          ops.push({
            account: LedgerAccount.REFERRAL,
            amount: referralBonus,
            type: 'escrow_release',
            refKey: `escrow_release:${orderId}:REFERRAL`,
            userId: order.referralUserId,
            orderId,
          });
        }
        // ФИКС 4: пропуск проводки по дублю refKey = расхождение с уже
        // изменённым состоянием заказа → ALERT + откат.
        this.assertLedgerApplied(
          await this.ledger.apply(tx, ops, { assertZeroSum: true }),
          `settleRelease(adSplit, ${reason})`,
          orderId,
        );
      } else {
        // Обычный путь без изменений (§4.3).
        // ФИКС 4: см. assertLedgerApplied.
        this.assertLedgerApplied(
          await this.ledger.release(tx, {
            orderId,
            buyerId: order.buyerId,
            sellerId: order.sellerId,
            amount,
            platformFee: platformCut,
            sellerNet,
            referralUserId: order.referralUserId,
            referralBonus,
            meta: { reason },
          }),
          `settleRelease(${reason})`,
          orderId,
        );
      }

      return true;
    });

    if (!claimed) return empty;

    if (buyerRefund > 0) {
      // Рекламодатель: возврат за неотработанные дни (не весь заказ).
      await this.notifySafely(
        order.buyerId,
        'ad_settled',
        `Реклама закрыта. За неотработанные дни возвращено ${buyerRefund} USDT.`,
        orderId,
      );
    }
    await this.notifySafely(
      order.sellerId,
      'escrow_released',
      adSplit
        ? `Рекламный заказ закрыт. Платформа получила ${platformCut} USDT.`
        : `Заказ завершён. Зачислено ${sellerNet} USDT на баланс.`,
      orderId,
    );
    if (order.referralUserId && referralBonus > 0) {
      await this.notifySafely(
        order.referralUserId,
        'referral_bonus',
        `Начислен реферальный бонус: ${referralBonus} USDT`,
        orderId,
      );
    }

    this.logger.log(
      `Escrow RELEASED for order ${orderId} (${reason}): seller +${sellerNet}, platform +${platformCut}, buyer +${buyerRefund}`,
    );

    return {
      released: true,
      amount,
      platformFee: platformCut,
      sellerNet,
      referralBonus,
      reason,
      postClosed,
    };
  }

  /**
   * NH9: сколько вернуть рекламодателю при закрытии рекламного заказа.
   *
   * Срок показа берём из `Transaction.payload.adDays` — там его фиксирует
   * createAd сразу после создания платежа (у `Post` поля под срок нет,
   * схему делят несколько билдеров). Факт и старт показа — `isPinned` и
   * `adExpireDate`.
   *
   * Три случая:
   *  1. показа не было (объявление не активировано / нет данных о сроке) —
   *     услуга не оказана вовсе, возвращаем ВСЁ. Иначе таймаут списал бы
   *     деньги за рекламу, которая ни дня не показывалась;
   *  2. срок истёк — возвращать нечего, услуга отработана полностью;
   *  3. показ идёт — возвращаем долю за оставшиеся дни.
   */
  private async adSettlement(order: {
    id: string;
    amount: number;
    escrowAmount: number;
  }): Promise<{ refund: number }> {
    const fullRefund = round2(
      order.escrowAmount > 0 ? order.escrowAmount : order.amount,
    );
    try {
      const tx = await this.prisma.transaction.findFirst({
        where: { orderId: order.id },
        orderBy: { createdAt: 'desc' },
        select: { payload: true },
      });
      const payload = tx?.payload as
        | { adDays?: unknown; days?: unknown }
        | null
        | undefined;
      const days = Math.floor(Number(payload?.adDays ?? payload?.days ?? NaN));

      const post = await this.prisma.post.findUnique({
        where: { orderId: order.id },
        select: { isPinned: true, adExpireDate: true },
      });
      const expireAt = post?.adExpireDate ?? null;

      // Показ не начинался — платформа услугу не оказала.
      if (!post?.isPinned || !expireAt) return { refund: fullRefund };
      if (!Number.isFinite(days) || days < 1) return { refund: fullRefund };

      const now = Date.now();
      const expireMs = expireAt.getTime();
      // Срок истёк — показ отстоял весь оплаченный период.
      if (!Number.isFinite(expireMs) || expireMs <= now) return { refund: 0 };

      const dayMs = 24 * 60 * 60 * 1000;
      const unused = Math.min(Math.floor((expireMs - now) / dayMs), days);
      if (unused < 1) return { refund: 0 };

      const perDay = fullRefund / days;
      return { refund: round2(perDay * unused) };
    } catch (err) {
      // Расчёт — не повод не закрыть эскроу. При сбое не списываем деньги
      // за неоказанную услугу: возвращаем всё рекламодателю.
      this.logger.warn(
        `settleAdSale: refund calc for order ${order.id} failed: ${(err as Error).message}`,
      );
      return { refund: fullRefund };
    }
  }

  // ============================================================
  // Чтение
  // ============================================================

  /**
   * Вернуть эскроу покупателю. buyerSharePct = 100 — полный возврат
   * (escrowStatus = REFUNDED), меньше 100 — распределение по вердикту
   * арбитража (escrowStatus = SPLIT).
   *
   * Комиссия платформы взимается пропорционально доле продавца, чтобы
   * платформа не зарабатывала на споре (§5.3).
   *
   * NH10 (КРИТ): для РЕКЛАМНОГО заказа метод не возвращает 100%/pct «как есть».
   * См. refundAdOrder — там возврат считается за неотработанные дни показа, а
   * объявление гасится в той же транзакции. Это закрывает ВСЕ входы возврата
   * рекламы (арбитраж, adminForceStatus REFUNDED/CANCELLED, любой будущий),
   * а не только cron-таймаут, который закрыл NH9.
   */
  async refundEscrow(
    orderId: string,
    reason: EscrowCloseReason = 'seller_no_ship_timeout',
    buyerSharePct = 100,
  ): Promise<EscrowRefundResult> {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { post: { select: { id: true, isAd: true } } },
    });

    const pct = Math.min(Math.max(buyerSharePct, 0), 100);
    const empty: EscrowRefundResult = {
      refunded: false,
      escrowAmount: 0,
      toBuyer: 0,
      toSeller: 0,
      feeCut: 0,
      buyerSharePct: pct,
      reason,
      postClosed: false,
    };

    if (order.escrowStatus !== EscrowStatus.HELD) return empty;

    // NH10: признак рекламы — прямая связь `Order.post` + `post.isAd` (тот же
    // критерий, что в NH9/`settleIfAdOrder`), а не эвристика «sellerId ==
    // ADMIN»: админ может быть продавцом и обычного товара.
    if (order.post?.isAd) {
      return this.refundAdOrder(order, reason, pct, empty);
    }

    const escrowAmount = round2(order.escrowAmount || order.amount);
    if (!(escrowAmount > 0)) return empty;

    const toBuyer = round2((escrowAmount * pct) / 100);
    const feeCut = round2((order.platformFee * (100 - pct)) / 100);
    // Остаток отдаём продавцу: гарантирует toBuyer + toSeller + feeCut === escrowAmount
    // без потери копейки на округлении.
    const toSeller = round2(escrowAmount - toBuyer - feeCut);

    const claimed = await this.prisma.$transaction(async (tx) => {
      const guard = await tx.order.updateMany({
        where: { id: orderId, escrowStatus: EscrowStatus.HELD },
        data: {
          escrowStatus:
            pct === 100 ? EscrowStatus.REFUNDED : EscrowStatus.SPLIT,
          escrowClosedAt: new Date(),
          status: OrderStatus.REFUNDED,
          cancelledAt: new Date(),
          cancelReason: reason,
          autoCompleteAt: null,
        },
      });
      if (guard.count === 0) return false;

      // ФИКС 4: возврат уже перевёл заказ в REFUNDED/SPLIT — если проводки
      // не записались, деньги остались в эскроу при закрытом заказе.
      // Алерт + откат транзакции (заказ вернётся в HELD, деньги на месте).
      const refundResult = await this.ledger.refund(tx, {
        orderId,
        buyerId: order.buyerId,
        sellerId: order.sellerId,
        amount: escrowAmount,
        toBuyer,
        toSeller,
        feeCut,
        meta: { reason, buyerSharePct: pct },
      });
      this.assertLedgerApplied(
        refundResult,
        `refundEscrow(${reason})`,
        orderId,
      );

      return true;
    });

    if (!claimed) return empty;

    await this.notifySafely(
      order.buyerId,
      'escrow_refunded',
      `Возврат ${toBuyer} USDT зачислен на баланс.`,
      orderId,
    );
    if (toSeller > 0) {
      await this.notifySafely(
        order.sellerId,
        'escrow_split',
        `По спору зачислено ${toSeller} USDT на баланс.`,
        orderId,
      );
    }

    this.logger.log(
      `Escrow ${pct === 100 ? 'REFUNDED' : 'SPLIT'} for order ${orderId} (${reason}): buyer +${toBuyer}, seller +${toSeller}, platform +${feeCut}`,
    );

    return {
      refunded: true,
      escrowAmount,
      toBuyer,
      toSeller,
      feeCut,
      buyerSharePct: pct,
      reason,
      // Обычный товарный заказ — объявления тут нет, гасить нечего.
      postClosed: false,
    };
  }

  /**
   * NH10 (КРИТ): возврат по РЕКЛАМНОМУ заказу через `refundEscrow`.
   *
   * Дыра: `refundEscrow` про рекламу не знал и отдавал рекламодателю
   * `escrowAmount × pct/100` (при BUYER_RIGHT — 100%), переводя заказ в
   * REFUNDED. Объявление при этом не трогалось: `Post.isPinned` оставался
   * `true` до `adExpireDate`, то есть до 30 дней бесплатного показа в ленте.
   * Дыра воспроизводилась по двум маршрутам (verify7/report.md §3):
   *   A. арбитраж: рекламодатель сам открывает спор на своём заказе
   *      (`buyerId` = он же), вердикт BUYER_RIGHT/SPLIT → `refundEscrow`;
   *   B. админ: `adminForceStatus REFUNDED` / `CANCELLED` при HELD.
   * NH9 закрыл только третий маршрут (cron-таймаут → `settleAdSale`).
   *
   * Фикс (вариант A из ТЗ): рекламный возврат считаем как в `adSettlement` —
   * платформа оставляет себе плату за ОТРАБОТАННЫЕ дни показа, рекламодателю
   * возвращается доля за НЕотработанные, и объявление гасится
   * (`isPinned=false`, `adExpireDate=now`) в ТОЙ ЖЕ транзакции. Иначе
   * возвращённые дни показывались бы бесплатно.
   *
   * Почему не делегируем в `settleAdSale` буквально: тот НЕ трогает статус
   * заказа (оставляет PAID + RELEASED) — так закрывается cron-таймаут, где
   * заказ и не должен становиться REFUNDED. Но арбитраж и админ вызывают
   * `refundEscrow` именно затем, чтобы заказ получил терминальный статус.
   * Поэтому здесь деньги распределяются ровно как в `settleAdSale` (та же
   * формула `adSplit`), а статус заказа ставится так, как его ставит
   * `refundEscrow` для обычного заказа — REFUNDED (у `OrderStatus` нет
   * отдельного SPLIT: частичный возврат — это `EscrowStatus.SPLIT`, но для
   * рекламы эскроу закрывается как RELEASED, потому что услуга частично
   * оказана и «возвращена» она не была).
   *
   * `pct` (вердикт арбитража) при этом НЕ определяет сумму возврата — сумму
   * считает `adSettlement` по фактически показанным дням. Аргумент сохранён
   * для совместимости контракта арбитража.
   */
  private async refundAdOrder(
    order: {
      id: string;
      buyerId: string;
      sellerId: string;
      amount: number;
      escrowAmount: number;
      platformFee: number;
      referralUserId: string | null;
      referralBonus: number;
    },
    reason: EscrowCloseReason,
    pct: number,
    empty: EscrowRefundResult,
  ): Promise<EscrowRefundResult> {
    const amount = round2(order.amount);
    const platformFee = round2(order.platformFee);
    const referralBonus =
      order.referralUserId && order.referralBonus > 0
        ? round2(order.referralBonus)
        : 0;
    const sellerNetBase = round2(amount - platformFee - referralBonus);

    // Та же арифметика, что в settleRelease(adSplit): возврат ограничен
    // реально удержанным (выручка за показ + доля продавца), списывается
    // сначала с выручки платформы, затем с доли продавца.
    const refundable = round2(amount - referralBonus);
    const { refund: wanted } = await this.adSettlement(order);
    let buyerRefund = Math.max(0, Math.min(round2(wanted), refundable));

    const fromPlatform = Math.min(buyerRefund, platformFee);
    const fromSeller = Math.min(
      round2(buyerRefund - fromPlatform),
      sellerNetBase,
    );
    buyerRefund = round2(fromPlatform + fromSeller);
    const platformCut = round2(platformFee - fromPlatform);
    const sellerNet = round2(sellerNetBase - fromSeller);

    const claimed = await this.prisma.$transaction(async (tx) => {
      const guard = await tx.order.updateMany({
        where: { id: order.id, escrowStatus: EscrowStatus.HELD },
        data: {
          escrowStatus: EscrowStatus.RELEASED,
          escrowClosedAt: new Date(),
          status: OrderStatus.REFUNDED,
          cancelledAt: new Date(),
          cancelReason: reason,
          autoCompleteAt: null,
        },
      });
      if (guard.count === 0) return false;

      // Объявление гасим всегда, когда возврат рекламодателю ушёл за
      // неотработанные дни (иначе они показывались бы бесплатно) или когда
      // платформа оставила себе плату за показ (услуга частично оказана —
      // дальше показывать нечего). Не гасим только случай «показа не было»:
      // там деньги целиком вернулись, и объявление неактивно само по себе.
      if (platformCut > 0 || buyerRefund > 0) {
        await tx.post.updateMany({
          where: { orderId: order.id },
          data: { isPinned: false, adExpireDate: new Date() },
        });
      }

      // Проводки — ровно как в settleRelease(adSplit): эскроу → платформа +
      // возврат рекламодателю [+ доля продавца]. `ledger.refund` для рекламы
      // не годится: он бы перевёл заказ в REFUNDED/SPLIT через свои refKey и
      // разошёлся с уже выставленным статусом/флагами.
      const ops: LedgerOp[] = [
        {
          account: LedgerAccount.ESCROW,
          amount: -amount,
          type: 'escrow_release',
          refKey: `escrow_release:${order.id}:ESCROW`,
          userId: order.buyerId,
          orderId: order.id,
        },
        {
          account: LedgerAccount.PLATFORM,
          amount: platformCut,
          type: 'platform_fee',
          refKey: `escrow_release:${order.id}:PLATFORM`,
          userId: null,
          orderId: order.id,
        },
        {
          account: LedgerAccount.AVAILABLE,
          amount: buyerRefund,
          type: 'escrow_refund',
          refKey: `escrow_refund:${order.id}:AVAILABLE`,
          userId: order.buyerId,
          orderId: order.id,
        },
      ];
      if (sellerNet > 0) {
        ops.push({
          account: LedgerAccount.AVAILABLE,
          amount: sellerNet,
          type: 'escrow_release',
          refKey: `escrow_release:${order.id}:AVAILABLE`,
          userId: order.sellerId,
          orderId: order.id,
        });
      }
      if (referralBonus > 0 && order.referralUserId) {
        ops.push({
          account: LedgerAccount.REFERRAL,
          amount: referralBonus,
          type: 'escrow_release',
          refKey: `escrow_release:${order.id}:REFERRAL`,
          userId: order.referralUserId,
          orderId: order.id,
        });
      }
      // ФИКС 4: см. assertLedgerApplied.
      this.assertLedgerApplied(
        await this.ledger.apply(tx, ops, { assertZeroSum: true }),
        `refundAdOrder(${reason})`,
        order.id,
      );

      return true;
    });

    if (!claimed) return empty;

    const postClosed = platformCut > 0 || buyerRefund > 0;

    if (buyerRefund > 0) {
      await this.notifySafely(
        order.buyerId,
        'ad_settled',
        `Реклама закрыта. За неотработанные дни возвращено ${buyerRefund} USDT.`,
        order.id,
      );
    }
    await this.notifySafely(
      order.sellerId,
      'escrow_released',
      `Рекламный заказ закрыт. Платформа получила ${platformCut} USDT.`,
      order.id,
    );

    this.logger.log(
      `Escrow ${pct === 100 ? 'REFUNDED' : 'SPLIT'} (ad) for order ${order.id} (${reason}): platform +${platformCut}, advertiser +${buyerRefund}`,
    );

    return {
      refunded: true,
      escrowAmount: amount,
      toBuyer: buyerRefund,
      toSeller: sellerNet,
      feeCut: platformCut,
      buyerSharePct: pct,
      reason,
      postClosed,
    };
  }

  // ============================================================
  // Чтение
  // ============================================================

  /**
   * Сколько заморожено у продавца (§4.6). Продавец видит эти деньги,
   * но вывести их не может — снимает вопросы в поддержку.
   */
  async getSellerPendingEscrow(userId: string): Promise<number> {
    const agg = await this.prisma.order.aggregate({
      where: { sellerId: userId, escrowStatus: EscrowStatus.HELD },
      _sum: { escrowAmount: true },
    });
    return round2(agg._sum.escrowAmount ?? 0);
  }

  /** Все заказы продавца в эскроу (для UI-раздела «ожидает подтверждения»). */
  async getSellerEscrowOrders(userId: string) {
    return this.prisma.order.findMany({
      where: { sellerId: userId, escrowStatus: EscrowStatus.HELD },
      select: {
        id: true,
        amount: true,
        escrowAmount: true,
        escrowStatus: true,
        escrowHeldAt: true,
        autoCompleteAt: true,
        status: true,
      },
      orderBy: { escrowHeldAt: 'desc' },
    });
  }

  /** Эскроу-состояние конкретного заказа (guard для контроллеров). */
  async getEscrowState(orderId: string): Promise<{
    escrowStatus: EscrowStatus;
    escrowAmount: number;
    autoCompleteAt: Date | null;
  }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        escrowStatus: true,
        escrowAmount: true,
        autoCompleteAt: true,
      },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    return order;
  }

  // ============================================================
  // Внутреннее
  // ============================================================

  private async getIntSetting(key: string, fallback: number): Promise<number> {
    const raw = await this.settings.getFloat(key);
    if (!Number.isFinite(raw) || raw <= 0) return fallback;
    return Math.round(raw);
  }

  /**
   * ФИКС 4: «проводка не применилась, а должна была» — это ошибка, а не
   * тихий пропуск.
   *
   * `LedgerService.apply` идемпотентен: `createMany({ skipDuplicates: true })`
   * молча пропускает уже существующий refKey. Для легитимного повтора это
   * правильно, но если refKey уже занят, а состояние заказа при этом
   * ПЕРЕШЛО в целевое (escrowStatus=RELEASED/REFUNDED, деньги списаны с
   * эскроу), значит проводки разошлись с реальностью — деньги потерялись
   * или нарисовались.
   *
   * Отличие от легитимного повтора: там до записи НЕ доходит вовсе — гард
   * `updateMany({ escrowStatus: HELD })` возвращает count=0, транзакция
   * выходит по `claimed=false`, и `apply` не вызывается. То есть любой
   * skipped внутри этой транзакции — коллизия refKey, а не повтор операции.
   * Ровно так же это различает `approveWithdrawal` (users.service.ts:470):
   * `applied.length === 1 && skipped.length === 0`.
   *
   * Реакция как в NH1: `logger.error` ALERT + бросок наверх. Транзакция
   * откатится целиком — заказ останется в HELD, деньги на месте, а не
   * «эскроу закрыт, проводок нет».
   */
  private assertLedgerApplied(
    result: LedgerApplyResult,
    what: string,
    orderId: string,
  ): void {
    if (!result.skipped.length) return;
    const message =
      `${what}: проводка не применилась (дубль refKey), но состояние заказа уже ` +
      `изменено — откат транзакции. order=${orderId}, skipped=${result.skipped.join(', ')}`;
    this.logger.error(`ALERT ${message}`);
    throw new LedgerInvariantError(message);
  }

  /** Уведомления не должны ронять денежную операцию. */
  private async notifySafely(
    userId: string,
    type: string,
    message: string,
    relatedId?: string,
  ): Promise<void> {
    try {
      await this.notify.createNotification(userId, type, message, relatedId);
      await this.notify.sendToUser(
        userId,
        { en: 'Базар' },
        { en: message },
        { screen: type },
      );
    } catch (err) {
      this.logger.warn(
        `Escrow notification to ${userId} failed: ${(err as Error).message}`,
      );
    }
  }
}

/** Хелпер для тестов и внешних вызовов: сумма проводок группы = 0. */
export function escrowSplitInvariant(
  amount: number,
  parts: { toBuyer: number; toSeller: number; feeCut: number },
): boolean {
  const total = round2(parts.toBuyer + parts.toSeller + parts.feeCut);
  return total === round2(amount);
}

export type EscrowTx = Prisma.TransactionClient;
