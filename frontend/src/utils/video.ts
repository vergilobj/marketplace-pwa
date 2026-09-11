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