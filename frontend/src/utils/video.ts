// Определение типа видео-ссылки и построение embed-URL.
// Внутренние ссылки площадки (/uploads/videos/*) отдаются как <video>.
// Поддерживаемые хостинги: YouTube, RuTube, VK Video, Яндекс.Диск, Google Диск, Telegram.

import { isInternalVideo } from '../api/upload';

export type VideoEmbed =
  | { type: 'iframe'; src: string; label?: string }
  | { type: 'video'; src: string; label?: string }
  | { type: 'link'; src: string; label: string };

export function getVideoEmbed(rawUrl?: string | null): VideoEmbed | null {
  if (!rawUrl) return null;
  const url = rawUrl.trim();
  if (!url) return null;

  // Внутреннее загруженное видео
  if (isInternalVideo(url)) {
    return { type: 'video', src: url };
  }

  // Прямая ссылка на видеофайл (в т.ч. относительный /uploads/...)
  if (isDirectVideoUrl(url)) {
    return { type: 'video', src: url };
  }

  // YouTube
  const yt =
    url.match(/(?:youtube\.com\/watch\?[^#]*\bv=)([\w-]{6,})/i) ||
    url.match(/youtu\.be\/([\w-]{6,})/i) ||
    url.match(/youtube\.com\/shorts\/([\w-]{6,})/i) ||
    url.match(/youtube\.com\/embed\/([\w-]{6,})/i);
  if (yt) {
    return {
      type: 'iframe',
      src: `https://www.youtube.com/embed/${yt[1]}`,
      label: 'YouTube',
    };
  }

  // RuTube
  const rt = url.match(/rutube\.ru\/(?:video|play\/embed)\/([\w-]{4,})/i);
  if (rt) {
    return {
      type: 'iframe',
      src: `https://rutube.ru/play/embed/${rt[1]}`,
      label: 'RuTube',
    };
  }

  // VK Video — vk.com/video-123_456 или vkvideo.ru/video-123_456
  const vk = url.match(/(?:vk\.com|vkvideo\.ru)\/video(-?\d+)_(\d+)/i);
  if (vk) {
    const oid = vk[1];
    const vid = vk[2];
    return {
      type: 'iframe',
      src: `https://vk.com/video_ext.php?oid=${oid}&id=${vid}&hd=2`,
      label: 'VK Video',
    };
  }

  // Яндекс.Диск — embed нестабилен, даём ссылку
  if (/disk\.yandex\.ru\//i.test(url)) {
    return { type: 'link', src: url, label: 'Яндекс.Диск' };
  }

  // Google Диск — embed нестабилен, даём ссылку
  if (/drive\.google\.com\//i.test(url)) {
    return { type: 'link', src: url, label: 'Google Диск' };
  }

  // Telegram
  if (/(?:^|\/\/|\.)t\.me\//i.test(url)) {
    return { type: 'link', src: url, label: 'Telegram' };
  }

  // Неизвестный хостинг — просто ссылка
  return { type: 'link', src: url, label: 'Видео' };
}

/**
 * Прямая ссылка на видеофайл: загруженное на площадку видео (/uploads/videos/…)
 * или любой URL с видео-расширением. Такое играем через <video>, а не iframe.
 */
export function isDirectVideoUrl(url?: string | null): boolean {
  if (!url) return false;
  const u = url.trim();
  if (!u) return false;
  if (isInternalVideo(u)) return true;
  return /\.(mp4|webm|mov|mkv|m4v|ogv)(\?.*)?$/i.test(u);
}

/**
 * Слайд единой галереи: видео и фото в одном массиве.
 * Видео ВСЕГДА первым — так требует владелец (не отдельный блок).
 */
export type GallerySlide = {
  type: 'video' | 'image' | 'embed';
  src: string;
  label?: string;
};

export function buildGallery(
  media?: string[] | string | null,
  videoUrl?: string | null,
): GallerySlide[] {
  const list = Array.isArray(media) ? media : typeof media === 'string' ? [media] : [];
  const slides: GallerySlide[] = [];

  const v = (videoUrl || '').trim();
  if (v) {
    const embed = getVideoEmbed(v);
    if (embed?.type === 'video') slides.push({ type: 'video', src: embed.src });
    else if (embed?.type === 'iframe') slides.push({ type: 'embed', src: embed.src, label: embed.label });
    // embed?.type === 'link' (Яндекс/Google/Telegram) в галерею не кладём —
    // такие ссылки рендерятся отдельной ссылкой под текстом.
  }

  for (const m of list) {
    if (typeof m === 'string' && m.trim()) slides.push({ type: 'image', src: m.trim() });
  }

  return slides;
}

/** Индекс первого слайда с картинкой — для eager-загрузки первого фото. */
export function firstImageIndex(slides: GallerySlide[]): number {
  return slides.findIndex((s) => s.type === 'image');
}