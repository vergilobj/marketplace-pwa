import { useEffect, useMemo, useState } from 'react';

interface TokenPayload {
  sub?: string;
  role?: string;
  exp?: number;
}

/**
 * Декодирует payload JWT.
 *
 * JWT (RFC 7515) кодируется base64url: алфавит `-`/`_` вместо `+`/`/`,
 * padding `=` необязателен. Браузерный `atob` принимает ТОЛЬКО обычный
 * base64 и на `-`/`_` бросает InvalidCharacterError.
 *
 * Раньше это валило `JSON.parse(atob(accessToken.split('.')[1]))` в LoginPage
 * ПОСЛЕ записи токена в localStorage: токен уже сохранён, а `navigate('/')`
 * не выполнялся — юзер залипал на /login с валидным токеном
 * (симптом клик-теста: `{path: "/login", token: true}`).
 *
 * Возвращает null вместо throw: разбор токена не должен ронять вызывающий код.
 */
export function decodeJwtPayload(token: string | null | undefined): TokenPayload | null {
  if (!token) return null;
  const segment = token.split('.')[1];
  if (!segment) return null;
  try {
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    // payload — UTF-8 (в name/phone может быть кириллица), декодируем корректно
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as TokenPayload;
  } catch {
    return null;
  }
}

export function useAuth() {
  const token = localStorage.getItem('accessToken');

  /**
   * Момент монтирования. Date.now() — нечистая функция, её вызов в теле рендера
   * (включая useMemo) запрещён правилом react-hooks/purity. Ленивый инициализатор
   * useState — допустимое место для однократного чтения часов.
   */
  const [mountedAt] = useState(() => Date.now());

  /** Разбор токена — чистая функция от token. */
  const payload = useMemo<TokenPayload | null>(() => decodeJwtPayload(token), [token]);

  /**
   * Удаление протухшего/битого токена — побочный эффект (запись в localStorage),
   * поэтому вынесено из рендера в эффект: в рендере он выполнялся бы на каждый
   * прогон и мог удалить токен прямо во время отрисовки.
   */
  useEffect(() => {
    if (!token) return;
    if (!payload || (payload.exp && payload.exp * 1000 < Date.now())) {
      localStorage.removeItem('accessToken');
    }
  }, [token, payload]);

  const expired = !!payload?.exp && payload.exp * 1000 < mountedAt;
  const user = !token || !payload || expired ? null : { id: payload.sub, role: payload.role };

  return {
    user,
    isAuthenticated: !!user,
    isAdmin: user?.role === 'ADMIN',
    isSeller: user?.role === 'SELLER',
    isBuyer: user?.role === 'BUYER',
  };
}