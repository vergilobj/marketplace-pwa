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

export default formatPrice;