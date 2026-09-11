/**
 * Денежная математика (§6.3 ТЗ).
 *
 * Все суммы в атомарных единицах считаются через BigInt — Number теряет
 * точность выше 2^53, поэтому конвертация идёт через строку.
 * Точность хранения — 6 знаков (1e6 микроединиц), что с запасом покрывает
 * USDT и любые токены с decimals >= 6.
 */

const TEN = 10n;
const MICRO = 1_000_000;

/** Округление денег до 2 знаков (USDT-копейки). */
export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Сумма списка сумм с округлением до 2 знаков. */
export function sum2(values: number[]): number {
  return round2(values.reduce((acc, v) => acc + v, 0));
}

/**
 * number (USDT) -> атомарные единицы (string, BigInt-safe).
 * toRaw(1000, 18) === '1000000000000000000000'
 */
export function toRaw(amount: number, decimals: number): string {
  if (!Number.isFinite(amount)) throw new Error('toRaw: amount is not finite');
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error('toRaw: decimals must be a non-negative integer');
  }
  const micros = BigInt(Math.round(amount * MICRO));
  if (decimals <= 6) {
    return (micros / TEN ** BigInt(6 - decimals)).toString();
  }
  return (micros * TEN ** BigInt(decimals - 6)).toString();
}

/**
 * атомарные единицы -> number (USDT).
 * fromRaw('1000000000000000000000', 18) === 1000
 */
export function fromRaw(
  raw: string | bigint | null | undefined,
  decimals: number,
): number {
  if (raw === null || raw === undefined || raw === '') return 0;
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error('fromRaw: decimals must be a non-negative integer');
  }
  const value = typeof raw === 'bigint' ? raw : BigInt(String(raw).trim());
  if (decimals <= 6) {
    return Number(value * TEN ** BigInt(6 - decimals)) / MICRO;
  }
  return Number(value / TEN ** BigInt(decimals - 6)) / MICRO;
}

/** Дата + N дней (иммутабельно). */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setDate(result.getDate() + days);
  return result;
}

/** Дата + N минут (иммутабельно). */
export function addMinutes(date: Date, minutes: number): Date {
  const result = new Date(date.getTime());
  result.setMinutes(result.getMinutes() + minutes);
  return result;
}

/** Разбивка суммы заказа на комиссии и выручку продавца (§7.4). */
export interface FeeSplit {
  platformFee: number;
  referralBonus: number;
  sellerNet: number;
}

/**
 * Расчёт комиссий заказа (§7.4 ТЗ). Считается ОДИН раз при создании заказа
 * и снапшотится в Order — ставки, изменённые позже, не влияют на заказ.
 *
 * Инвариант: platformFee + referralBonus + sellerNet === amount.
 */
export function computeFees(
  amount: number,
  platformPercent: number,
  referralPercent: number,
  hasReferrer: boolean,
): FeeSplit {
  const total = round2(amount);
  const platformFee = round2((total * platformPercent) / 100);
  const referralBonus = hasReferrer ? round2((total * referralPercent) / 100) : 0;
  const sellerNet = round2(total - platformFee - referralBonus);
  return { platformFee, referralBonus, sellerNet };
}

/**
 * Инвариант внутренних переводов: сумма проводок одной группы = 0.
 * Используется для release/refund — деньги не создаются из воздуха
 * и не исчезают (§10 ТЗ).
 */
export function assertBalanced(
  entries: Array<{ amount: number }>,
  context = 'ledger',
): void {
  const total = sum2(entries.map((e) => e.amount));
  if (total !== 0) {
    throw new Error(
      `${context}: unbalanced ledger group, sum=${total} (must be 0)`,
    );
  }
}