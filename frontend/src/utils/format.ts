/**
 * Единое форматирование чисел, цен и дат по всему приложению.
 *
 * Правило цены (R22): разделитель разрядов — обычный пробел,
 * копейки показываются ТОЛЬКО если они есть. Валюта — USDT.
 *
 *   3500        -> "3 500 USDT"
 *   178072.43   -> "178 072.43 USDT"
 *   0           -> "0 USDT"
 */

import { format, formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';

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

/** «3 товара», «1 товар» — число + склонённое существительное одной строкой. */
export function pluralize(n: number, forms: [string, string, string]): string {
  return `${formatNumber(n)} ${plural(n, forms)}`;
}

/** Готовые наборы форм — чтобы не дублировать кортежи по страницам. */
export const PLURAL = {
  товар: ['товар', 'товара', 'товаров'] as [string, string, string],
  заказ: ['заказ', 'заказа', 'заказов'] as [string, string, string],
  день: ['день', 'дня', 'дней'] as [string, string, string],
  пост: ['пост', 'поста', 'постов'] as [string, string, string],
  отзыв: ['отзыв', 'отзыва', 'отзывов'] as [string, string, string],
  приглашение: ['приглашение', 'приглашения', 'приглашений'] as [string, string, string],
  уведомление: ['уведомление', 'уведомления', 'уведомлений'] as [string, string, string],
};

/**
 * Вид формата даты.
 *
 *   short    — «15 сент., 14:32»      списки, карточки, таблицы
 *   full     — «15 сентября 2026, 14:32»  детали, тред, шапка обращения
 *   relative — «5 мин назад», но ТОЛЬКО пока событие свежее (<24 ч);
 *              дальше автоматически падает в `short` — «3 недели назад»
 *              рядом с датой заказа бесполезно, а место занимает.
 */
export type DateKind = 'short' | 'full' | 'relative';

/**
 * ЕДИНЫЙ формат дат по приложению (Волна 2 / B4).
 *
 * До этого в проекте жило шесть разных форматов одной и той же даты
 * (`d MMM, HH:mm`, `d MMM`, `d MMM yyyy, HH:mm`, `d MMMM в HH:mm`,
 * `d MMMM yyyy`, `DD.MM, HH:mm`) — юзер видел «15 сент.» на одной странице
 * и «15.09, 14:32» на соседней. Теперь формат выбирается по назначению места,
 * а не по файлу, где этот код когда-то написали.
 *
 * Часовой пояс — локальный для устройства (в проекте это Europe/Samara,
 * UTC+4): даты приходят ISO-строками с Z, `new Date()` переводит их в
 * локальное время, и админ видит то же время, что и юзер.
 *
 * Невалидная/пустая дата → «—» (а не «Invalid Date» в интерфейсе).
 *
 *   formatDate('2026-09-15T10:32:00Z')            -> '15 сент., 14:32'
 *   formatDate('2026-09-15T10:32:00Z', 'full')    -> '15 сентября 2026, 14:32'
 *   formatDate(<5 минут назад>, 'relative')       -> '5 минут назад'
 *   formatDate(<3 дня назад>, 'relative')         -> '12 сент., 14:32'
 */
export function formatDate(iso: string | null | undefined, kind: DateKind = 'short'): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  if (kind === 'relative') {
    const diffMs = Date.now() - date.getTime();
    // Будущее и «старше суток» — не относительный формат.
    if (diffMs >= 0 && diffMs < 24 * 60 * 60 * 1000) {
      return formatDistanceToNow(date, { addSuffix: true, locale: ru });
    }
    return format(date, 'd MMM, HH:mm', { locale: ru });
  }

  if (kind === 'full') {
    return format(date, 'd MMMM yyyy, HH:mm', { locale: ru });
  }

  return format(date, 'd MMM, HH:mm', { locale: ru });
}

export default formatPrice;