/**
 * Единое форматирование чисел и цен по всему приложению.
 *
 * Правило цены (R22): разделитель разрядов — обычный пробел,
 * копейки показываются ТОЛЬКО если они есть. Валюта — USDT.
 *
 *   3500        -> "3 500 USDT"
 *   178072.43   -> "178 072.43 USDT"
 *   0           -> "0 USDT"
 */

const THIN = /[\u00A0\u202F\u2009]/g;

/** 5000 -> "5 000", 2500000 -> "2 500 000" */
export function formatNumber(n: number): string {
  if (n == null || !Number.isFinite(n)) return '0';
  return n.toLocaleString('ru-RU').replace(THIN, ' ');
}

/** Единый формат цены: 3500 -> "3 500 USDT", 178072.43 -> "178 072.43 USDT" */
export function formatPrice(value: number): string {
  if (value == null || !Number.isFinite(value)) return '—';

  const negative = value < 0;
  const abs = Math.abs(value);
  const hasCents = Math.abs(abs - Math.round(abs)) > 1e-9;

  const [intPart, fracPart] = abs.toFixed(hasCents ? 2 : 0).split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  return `${negative ? '-' : ''}${grouped}${fracPart ? `.${fracPart}` : ''} USDT`;
}

/**
 * G3: склонение существительного по числу (русские правила).
 *
 * В проекте утилиты склонения не было — введена здесь, в файле форматирования
 * чисел, и применена ТОЛЬКО в FavoritesPage («2 товаров» → «2 товара»).
 *
 *   plural(1, ['товар','товара','товаров'])  -> 'товар'
 *   plural(2, ['товар','товара','товаров'])  -> 'товара'
 *   plural(5, ['товар','товара','товаров'])  -> 'товаров'
 *   plural(11,...) -> 'товаров', plural(21,...) -> 'товар'
 */
export function plural(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(Math.trunc(n));
  const mod100 = abs % 100;
  const mod10 = abs % 10;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

export default formatPrice;