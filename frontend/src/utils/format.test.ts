import { describe, it, expect } from 'vitest';
import { formatPrice, formatNumber, plural } from './format';

describe('formatPrice', () => {
  it('groups thousands with a space', () => {
    expect(formatPrice(3500)).toBe('3 500 USDT');
  });

  it('formats zero', () => {
    expect(formatPrice(0)).toBe('0 USDT');
  });

  it('groups millions', () => {
    expect(formatPrice(1000000)).toBe('1 000 000 USDT');
  });

  it('keeps cents only when they exist', () => {
    expect(formatPrice(178072.43)).toBe('178 072.43 USDT');
    expect(formatPrice(84905.29)).toBe('84 905.29 USDT');
    expect(formatPrice(3200)).toBe('3 200 USDT');
  });

  it('handles float noise', () => {
    expect(formatPrice(4999.0)).toBe('4 999 USDT');
  });

  it('handles invalid input', () => {
    expect(formatPrice(NaN)).toBe('—');
  });
});

describe('formatNumber', () => {
  it('formats with space separators', () => {
    expect(formatNumber(5000)).toBe('5 000');
  });

  it('formats zero', () => {
    expect(formatNumber(0)).toBe('0');
  });

  it('formats millions', () => {
    expect(formatNumber(2500000)).toBe('2 500 000');
  });
});

describe('plural (G3)', () => {
  const товары: [string, string, string] = ['товар', 'товара', 'товаров'];

  it('склоняет по русским правилам', () => {
    expect(plural(1, товары)).toBe('товар');
    expect(plural(2, товары)).toBe('товара');
    expect(plural(3, товары)).toBe('товара');
    expect(plural(4, товары)).toBe('товара');
    expect(plural(5, товары)).toBe('товаров');
    expect(plural(0, товары)).toBe('товаров');
    expect(plural(10, товары)).toBe('товаров');
    expect(plural(20, товары)).toBe('товаров');
  });

  it('обрабатывает 11–14 как исключение', () => {
    expect(plural(11, товары)).toBe('товаров');
    expect(plural(12, товары)).toBe('товаров');
    expect(plural(13, товары)).toBe('товаров');
    expect(plural(14, товары)).toBe('товаров');
    expect(plural(111, товары)).toBe('товаров');
  });

  it('21 → товар, 22 → товара, 25 → товаров', () => {
    expect(plural(21, товары)).toBe('товар');
    expect(plural(22, товары)).toBe('товара');
    expect(plural(25, товары)).toBe('товаров');
    expect(plural(101, товары)).toBe('товар');
    expect(plural(102, товары)).toBe('товара');
  });

  it('не ломается на отрицательных', () => {
    expect(plural(-2, товары)).toBe('товара');
  });
});