import { describe, it, expect } from 'vitest';
import { formatPrice, formatNumber } from './format';

describe('formatPrice', () => {
  it('formats price with USDT currency symbol', () => {
    expect(formatPrice(1000)).toBe('1,000 USDT');
  });

  it('formats zero', () => {
    expect(formatPrice(0)).toBe('0 USDT');
  });

  it('formats large numbers with grouping', () => {
    expect(formatPrice(1000000)).toBe('1,000,000 USDT');
  });

  it('formats decimal numbers', () => {
    expect(formatPrice(1234.56)).toBe('1,234.56 USDT');
  });
});

describe('formatNumber', () => {
  it('formats with thousand separators', () => {
    expect(formatNumber(5000)).toBe('5 000');
  });

  it('formats zero', () => {
    expect(formatNumber(0)).toBe('0');
  });

  it('formats millions', () => {
    expect(formatNumber(2500000)).toBe('2 500 000');
  });
});
