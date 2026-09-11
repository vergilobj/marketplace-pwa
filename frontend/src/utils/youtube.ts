// Определяет, является ли URL ссылкой на YouTube-видео
// (поддерживает youtube.com/watch, youtu.be, youtube.com/shorts, m.youtube.com).

export function isYouTubeUrl(url?: string | null): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    return host === 'youtube.com' || host === 'youtu.be' || host === 'm.youtube.com';
  } catch {
    return false;
  }
}