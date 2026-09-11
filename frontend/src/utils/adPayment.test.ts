import { describe, it, expect } from 'vitest';
import {
  AD_PAYMENT_WINDOW_MS,
  adPaymentStatusLabel,
  adTotal,
  extractAdOrderId,
  formatTimeLeft,
  isAdPaymentFinal,
} from './adPayment';

describe('isAdPaymentFinal', () => {
  it('считает оплаченными только CONFIRMED/SWEPT', () => {
    expect(isAdPaymentFinal('CONFIRMED')).toBe(true);
    expect(isAdPaymentFinal('SWEPT')).toBe(true);
  });

  it('PENDING/FAILED/пусто — не финал', () => {
    expect(isAdPaymentFinal('PENDING')).toBe(false);
    expect(isAdPaymentFinal('FAILED')).toBe(false);
    expect(isAdPaymentFinal(null)).toBe(false);
    expect(isAdPaymentFinal(undefined)).toBe(false);
    expect(isAdPaymentFinal('')).toBe(false);
  });
});

describe('adPaymentStatusLabel', () => {
  it('переводит известные статусы', () => {
    expect(adPaymentStatusLabel('PENDING')).toBe('Ожидание оплаты');
    expect(adPaymentStatusLabel('CONFIRMED')).toBe('Оплачено');
    expect(adPaymentStatusLabel('SWEPT')).toBe('Зачислено');
    expect(adPaymentStatusLabel('FAILED')).toBe('Ошибка');
  });

  it('неизвестный статус пропускает как есть, пустой — как ожидание', () => {
    expect(adPaymentStatusLabel('WEIRD')).toBe('WEIRD');
    expect(adPaymentStatusLabel(null)).toBe('Ожидание оплаты');
  });
});

describe('formatTimeLeft', () => {
  it('форматирует MM:SS', () => {
    expect(formatTimeLeft(0)).toBe('00:00');
    expect(formatTimeLeft(59)).toBe('00:59');
    expect(formatTimeLeft(60)).toBe('01:00');
    expect(formatTimeLeft(900)).toBe('15:00');
    expect(formatTimeLeft(AD_PAYMENT_WINDOW_MS / 1000)).toBe('15:00');
  });

  it('не уходит в минус и терпит мусор', () => {
    expect(formatTimeLeft(-5)).toBe('00:00');
    expect(formatTimeLeft(NaN)).toBe('00:00');
    expect(formatTimeLeft(Infinity)).toBe('00:00');
  });
});

describe('adTotal', () => {
  it('умножает цену дня на дни', () => {
    expect(adTotal(5000, 3)).toBe(15000);
    expect(adTotal(0, 3)).toBe(0);
  });

  it('нечисло → 0', () => {
    expect(adTotal(NaN, 3)).toBe(0);
    expect(adTotal(5000, NaN)).toBe(0);
  });
});

describe('extractAdOrderId', () => {
  it('берёт orderId из ответа createAd', () => {
    expect(extractAdOrderId({ id: 'post-1', orderId: 'order-1' })).toBe('order-1');
  });

  it('падает на relation order, если поля нет', () => {
    expect(extractAdOrderId({ id: 'post-1', order: { id: 'order-2' } })).toBe('order-2');
  });

  it('null, если заказ не пришёл — платить нечем', () => {
    expect(extractAdOrderId({ id: 'post-1' })).toBeNull();
    expect(extractAdOrderId({ id: 'post-1', orderId: null, order: null })).toBeNull();
    expect(extractAdOrderId(null)).toBeNull();
    expect(extractAdOrderId(undefined)).toBeNull();
  });
});