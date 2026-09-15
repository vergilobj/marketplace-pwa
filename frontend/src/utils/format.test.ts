import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatPrice, formatNumber, plural, pluralize, formatDate, PLURAL } from './format';

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

describe('pluralize', () => {
  it('склеивает число и склонённую форму', () => {
    expect(pluralize(1, PLURAL.товар)).toBe('1 товар');
    expect(pluralize(2, PLURAL.товар)).toBe('2 товара');
    expect(pluralize(5, PLURAL.товар)).toBe('5 товаров');
  });

  it('группирует разряды в числе', () => {
    expect(pluralize(2500, PLURAL.товар)).toBe('2 500 товаров');
  });
});

/**
 * B4 §4: единый хелпер дат.
 *
 * Тесты держат контракт трёх форматов и границы. Всё считается в ЛОКАЛЬНОМ
 * часовом поясе (в проекте — Europe/Samara, UTC+4), поэтому «дата без времени»
 * строится через `new Date(y, m, d, h, min)`, а не ISO-строкой: ISO с `Z`
 * сдвинул бы час, и тест падал бы на любой машине с другим поясом.
 */
describe('formatDate — short (основной для списков)', () => {
  it('формат «15 сент., 14:32»', () => {
    expect(formatDate(new Date(2026, 8, 15, 14, 32).toISOString())).toBe('15 сент., 14:32');
  });

  it('дополняет минуты нулём', () => {
    expect(formatDate(new Date(2026, 8, 15, 9, 7).toISOString())).toBe('15 сент., 09:07');
  });

  it('полночь — 00:00, а не 24:00', () => {
    expect(formatDate(new Date(2026, 8, 15, 0, 0).toISOString())).toBe('15 сент., 00:00');
  });

  it('май склоняется как «мая» (не «май.»)', () => {
    expect(formatDate(new Date(2026, 4, 3, 10, 0).toISOString())).toBe('3 мая, 10:00');
  });

  it('двузначные дни не дополняются нулём', () => {
    expect(formatDate(new Date(2026, 0, 5, 10, 0).toISOString())).toBe('5 янв., 10:00');
  });
});

describe('formatDate — full (детали)', () => {
  it('формат «15 сентября 2026, 14:32»', () => {
    expect(formatDate(new Date(2026, 8, 15, 14, 32).toISOString(), 'full')).toBe(
      '15 сентября 2026, 14:32',
    );
  });

  it('месяц в родительном падеже', () => {
    expect(formatDate(new Date(2026, 0, 5, 9, 7).toISOString(), 'full')).toBe(
      '5 января 2026, 09:07',
    );
  });
});

describe('formatDate — relative (только свежее)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * «Сейчас» задаём ЛОКАЛЬНЫМ временем (не ISO с Z), а ожидания считаем от
   * того же момента — иначе тест был бы привязан к часовому поясу машины:
   * 12:00Z в Europe/Samara это 16:00, в UTC — 12:00.
   */
  const NOW = new Date(2026, 8, 15, 14, 0, 0);
  const freeze = () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  };

  /** Сдвиг от «сейчас» на ms назад (или вперёд) — в ISO. */
  const shift = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it('5 минут назад', () => {
    freeze();
    expect(formatDate(shift(-5 * MIN), 'relative')).toBe('5 минут назад');
  });

  it('меньше минуты назад', () => {
    freeze();
    expect(formatDate(shift(-10 * 1000), 'relative')).toBe('меньше минуты назад');
  });

  it('ровно минута назад', () => {
    freeze();
    expect(formatDate(shift(-MIN), 'relative')).toBe('1 минуту назад');
  });

  it('около часа назад', () => {
    freeze();
    expect(formatDate(shift(-HOUR), 'relative')).toBe('около 1 часа назад');
  });

  it('23 часа — ещё relative (граница «свежести» внутри суток)', () => {
    freeze();
    expect(formatDate(shift(-23 * HOUR), 'relative')).toMatch(/назад$/);
  });

  it('23:59 — ещё relative', () => {
    freeze();
    expect(formatDate(shift(-(23 * 60 + 59) * MIN), 'relative')).toMatch(/назад$/);
  });

  it('ровно сутки — уже short, а не «1 день назад»', () => {
    freeze();
    expect(formatDate(shift(-DAY), 'relative')).toBe('14 сент., 14:00');
  });

  it('вчера, но меньше суток назад — всё ещё relative', () => {
    freeze();
    // 15 сент. 14:00 → 14 сент. 20:00 = 18 часов: «вчера» по календарю,
    // но по возрасту это свежее событие, и relative тут уместен.
    expect(formatDate(new Date(2026, 8, 14, 20, 0).toISOString(), 'relative')).toBe(
      'около 18 часов назад',
    );
  });

  it('позавчера — short', () => {
    freeze();
    expect(formatDate(new Date(2026, 8, 13, 20, 0).toISOString(), 'relative')).toBe(
      '13 сент., 20:00',
    );
  });

  it('неделя — short', () => {
    freeze();
    expect(formatDate(shift(-7 * DAY), 'relative')).toBe('8 сент., 14:00');
  });

  it('месяц — short', () => {
    freeze();
    expect(formatDate(shift(-30 * DAY), 'relative')).toBe('16 авг., 14:00');
  });

  it('будущее время не показываем как relative', () => {
    freeze();
    expect(formatDate(shift(HOUR), 'relative')).toBe('15 сент., 15:00');
  });
});

describe('formatDate — невалидный ввод', () => {
  it('пустая строка → «—»', () => {
    expect(formatDate('')).toBe('—');
  });

  it('null / undefined → «—»', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
  });

  it('мусор вместо даты → «—», а не «Invalid Date»', () => {
    expect(formatDate('не дата')).toBe('—');
    expect(formatDate('2026-13-45T99:99:99Z')).toBe('—');
  });

  it('невалидная дата в любом формате → «—»', () => {
    expect(formatDate('не дата', 'full')).toBe('—');
    expect(formatDate('не дата', 'relative')).toBe('—');
  });
});

describe('formatDate — часовой пояс', () => {
  it('ISO с Z переводится в локальное время устройства', () => {
    // 2026-09-15T10:32:00Z в Europe/Samara (UTC+4) — это 14:32.
    // Тест привязан к локальному поясу машины, поэтому сверяем с тем же
    // смещением, которое даёт сам движок, а не с «магическим» числом.
    const iso = '2026-09-15T10:32:00Z';
    const local = new Date(iso);
    const expected = `${local.getDate()} сент., ${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`;
    expect(formatDate(iso)).toBe(expected);
  });

  it('ISO без зоны трактуется как локальное время', () => {
    expect(formatDate(new Date(2026, 8, 15, 14, 32).toISOString())).toBe('15 сент., 14:32');
  });

  it('один и тот же момент в двух формах даёт согласованные день/час', () => {
    const iso = new Date(2026, 8, 15, 14, 32).toISOString();
    expect(formatDate(iso)).toBe('15 сент., 14:32');
    expect(formatDate(iso, 'full')).toBe('15 сентября 2026, 14:32');
  });
});