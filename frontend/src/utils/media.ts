// Нормализация медиа-URL.
//
// Проблема, которую решает файл: бэкенд отдаёт АБСОЛЮТНЫЕ ссылки вида
// `http://localhost:3000/uploads/xxx.jpg` (UPLOAD_BASE_URL) или прод-домен.
// На внешнем устройстве (телефон через туннель ngrok/pinggy/cloudflare)
// `localhost` указывает на САМО устройство — картинка и видео не грузятся,
// в Network висит net::ERR_CONNECTION_REFUSED. Ровно поэтому «фото и видео
// ничего не работает».
//
// Решение: любые ссылки на нашу же статику приводим к ОТНОСИТЕЛЬНОМУ пути
// (/uploads/...). Тогда dev идёт через Vite-прокси, а prod — через nginx.

const PROD_ORIGIN = 'https://xn--80aabz0c.shop';
const LOCAL_ORIGIN = /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?/i;

export function resolveMedia(url?: string | null): string {
  if (!url) return '';
  let out = url.trim();
  if (!out) return '';

  // Прод-домен -> относительный путь.
  out = out.replace(PROD_ORIGIN, '');

  // Локальный абсолютный URL -> относительный путь (ломается на телефоне).
  out = out.replace(LOCAL_ORIGIN, '');

  // Любой чужой origin, ведущий на нашу статику, тоже делаем относительным:
  // статику /uploads отдаёт наш бэкенд (dev — Vite-прокси, prod — nginx).
  const m = out.match(/^https?:\/\/[^/]+(\/uploads\/.*)$/i);
  if (m) out = m[1];

  return out;
}

/** Список медиа к относительным путям (для галерей/слайдеров). */
export function resolveMediaList(urls?: (string | null | undefined)[] | null): string[] {
  if (!Array.isArray(urls)) return [];
  return urls.map(resolveMedia).filter(Boolean);
}