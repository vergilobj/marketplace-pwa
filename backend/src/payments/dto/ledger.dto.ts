import { LedgerAccount } from '@prisma/client';

/**
 * Типы проводок журнала (§1.2 ТЗ).
 * Строкой, а не enum: новые типы не должны требовать миграции БД.
 * NB: НЕ union с `string` — это убивает автокомплит и типобезопасность
 * (правило no-redundant-type-constituents). Для «свободных» типов из БД
 * есть отдельный алиас LedgerEntryTypeLoose.
 */
export type LedgerEntryType =
  | 'escrow_hold'
  | 'escrow_release'
  | 'escrow_refund'
  | 'withdrawal_debit'
  | 'withdrawal_reversal'
  | 'deposit_overpay'
  | 'orphan_deposit'
  | 'platform_fee'
  | 'referral_bonus';

/** Свободная форма: тип из БД/внешнего источника, не покрытый union'ом выше. */
export type LedgerEntryTypeLoose = LedgerEntryType | (string & {});

/** Одна проводка. amount ЗНАКОВЫЙ: плюс — зачисление, минус — списание. */
export interface LedgerOp {
  account: LedgerAccount;
  amount: number;
  type: LedgerEntryTypeLoose;
  /** Идемпотентность: повторный apply с тем же refKey — no-op. */
  refKey: string;
  /** null/undefined — платформенный аккаунт (PLATFORM, ESCROW-агрегат). */
  userId?: string | null;
  orderId?: string | null;
  dealId?: string | null;
  currency?: string;
  meta?: Record<string, unknown> | null;
}

export interface LedgerApplyOptions {
  /**
   * Проверять, что сумма проводок группы = 0 (внутренний перевод).
   * Для release/refund — true. Для внешних притоков (escrow_hold,
   * deposit_overpay) — false: деньги приходят из блокчейна, пары внутри
   * журнала у них нет.
   */
  assertZeroSum?: boolean;
  /** Не бросать исключение, если запись уже существует (default: true). */
  idempotent?: boolean;
}

export interface LedgerApplyResult {
  applied: string[];
  skipped: string[];
}

export interface LedgerBalances {
  /** Выводимая выручка продавца + возвраты покупателю. */
  availableBalance: number;
  /** Реферальные бонусы. */
  bonusBalance: number;
  /** Заморожено по журналу (SUM LedgerEntry.amount WHERE account=ESCROW). */
  escrowBalance: number;
  /** Заморожено по заказам (SUM Order.escrowAmount WHERE escrowStatus=HELD). */
  pendingEscrow: number;
  /** availableBalance + bonusBalance — то, что реально можно вывести. */
  totalWithdrawable: number;
}

export interface LedgerInvariantReport {
  ok: boolean;
  checkedAt: Date;
  /** Нарушения, требующие вмешательства. */
  problems: string[];
  /** Расхождения, допустимые на переходном периоде (сид-данные). */
  warnings: string[];
  totals: {
    available: number;
    referral: number;
    escrow: number;
    platform: number;
    /** SUM(Order.escrowAmount) WHERE escrowStatus = HELD. */
    heldOrdersEscrow: number;
    /** Сумма всех проводок = чистый приток из блокчейна. */
    netExternalInflow: number;
  };
}

/** Ошибка нарушения денежного инварианта. */
export class LedgerInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerInvariantError';
  }
}
