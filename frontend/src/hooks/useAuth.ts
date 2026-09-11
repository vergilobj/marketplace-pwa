import { useEffect, useMemo, useState } from 'react';

interface TokenPayload {
  sub?: string;
  role?: string;
  exp?: number;
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
  const payload = useMemo<TokenPayload | null>(() => {
    if (!token) return null;
    try {
      return JSON.parse(atob(token.split('.')[1]));
    } catch {
      return null;
    }
  }, [token]);

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