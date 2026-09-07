// Нормализация медиа-URL: в dev превращает прод-домен в относительный путь,
// чтобы картинки шли через Vite-прокси (иначе cross-origin блокирует их).

const PROD_ORIGIN = 'https://xn--80aabz0c.shop';

export function resolveMedia(url?: string | null): string {
  if (!url) return '';
  // В dev-режиме локально — отдаём относительный путь, чтобы не было cross-origin.
  if (import.meta.env.DEV) {
    return url.replace(PROD_ORIGIN, '');
  }
  return url;
}