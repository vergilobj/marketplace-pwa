/**
 * COSMETIC-2 — уведомление о редиректе с закрытого раздела.
 *
 * Флоу: ProtectedRoute при неподходящей роли уводит на «/». Тост, показанный
 * ДО анмаунта страницы, не переживает мгновенную навигацию (проверено: после
 * <Navigate> тоста нет), поэтому причина кладётся в sessionStorage, а лента
 * показывает её уже на своей стороне.
 *
 * Читаем ровно один раз (read-once): обычная перезагрузка главной тост не
 * повторяет, а back/forward на закрытый раздел — повторяет.
 */
import toast from 'react-hot-toast';

export interface AccessDeniedInfo {
  /** Закрытый путь, с которого ушли. */
  path: string;
  /** Машинная причина: SELLER | ADMIN | AUTH. */
  reason: string;
  /** Готовый текст для пользователя. */
  message: string;
}

const KEY = 'accessDeniedNotice';

/** Запомнить причину ухода с закрытого раздела. */
export function rememberAccessDenied(info: AccessDeniedInfo): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(info));
  } catch {
    /* приватный режим / переполнение — тост просто не покажется */
  }
}

/** Прочитать и сразу стереть — вызывается на странице-приёмнике. */
export function consumeAccessDenied(): AccessDeniedInfo | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    const parsed = JSON.parse(raw) as AccessDeniedInfo;
    return parsed && typeof parsed.message === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

/** Показать тост о причине редиректа (единая точка). */
export function showAccessDeniedToast(info: AccessDeniedInfo): void {
  toast(info.message, { icon: '🔒', duration: 4000 });
}