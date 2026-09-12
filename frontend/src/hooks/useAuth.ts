import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { getProfile, becomeSeller } from '../api/users';

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

/* ------------------------------------------------------------------------ */
/* BUG-2: общий auth-стор.                                                   */
/*                                                                           */
/* Роль зашита в клейм access-токена и выдаётся в момент логина. Если админ  */
/* одобрил заявку (или сменил роль напрямую), пока приложение было открыто,  */
/* токен в localStorage остаётся старым: /products/new редиректил на `/`,    */
/* хотя сервер уже отдавал role=SELLER. Лечится двумя вещами:                */
/*   1) ре-фетч серверной роли (refreshAuth) — при входе на защищённый роут, */
/*      при возврате фокуса в окно и при монтировании профиля;               */
/*   2) если серверная роль новее клейма — забираем свежий accessToken       */
/*      (POST /users/become-seller идемпотентен и подписывает токен текущей  */
/*      ролью из БД; для не-BUYER он просто возвращает юзера как есть).      */
/* ------------------------------------------------------------------------ */

/** Счётчик ревизий: useSyncExternalStore перерисовывает по изменению строки-снапшота. */
let revision = 0;
/** Роль, подтверждённая сервером (GET /users/me). */
let serverRole: string | null = null;
/** Токен, для которого получена serverRole: после релогина кэш недействителен. */
let serverRoleToken: string | null = null;
/**
 * Токен, для которого попытка ре-фетча ЗАВЕРШИЛАСЬ (успех или ошибка).
 * Нужен guard'у: пока проверка не завершена, редиректить нельзя — иначе
 * первый же клик по /products/new выбросит BUYER'а на `/` до того, как
 * приедет свежая роль.
 */
let roleCheckSettledToken: string | null = null;
let refreshInFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function readToken(): string | null {
  try {
    return localStorage.getItem('accessToken');
  } catch {
    return null;
  }
}

function emit(): void {
  revision += 1;
  listeners.forEach((listener) => listener());
}

/** Снапшот для useSyncExternalStore: ревизия + токен (JWT не содержит `:`). */
function getSnapshot(): string {
  return `${revision}:${readToken() ?? ''}`;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Другая вкладка обновила токен — подхватываем.
  const onStorage = (event: StorageEvent) => {
    if (event.key === 'accessToken') emit();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/**
 * Сбрасывает кэш роли/юзера (логаут). Вызывать после localStorage.clear().
 */
export function clearAuthState(): void {
  serverRole = null;
  serverRoleToken = null;
  roleCheckSettledToken = null;
  emit();
}

/**
 * Перезапрашивает профиль с сервера и, если роль изменилась, обновляет
 * состояние (и токен — чтобы API-гарды на бэке тоже видели новую роль).
 *
 * Безопасно вызывать часто: параллельные вызовы схлопываются в один запрос,
 * ошибки (сеть/401) не пробрасываются — состояние остаётся по токену.
 *
 * @param force true — игнорировать кэш «для этого токена уже проверяли».
 *   Нужен триггерам «пользователь вернулся в приложение» (focus/визибилити/
 *   интервал) и ручной кнопке: роль могла смениться ПОСЛЕ первой проверки,
 *   а токен при этом остался тем же.
 */
export async function refreshAuth(force = false): Promise<void> {
  const token = readToken();
  if (!token) {
    if (serverRole || serverRoleToken) {
      serverRole = null;
      serverRoleToken = null;
      emit();
    }
    roleCheckSettledToken = null;
    return;
  }
  // Уже ре-фетчили для ЭТОГО токена и это не принудительный вызов — не
  // дёргаем сеть на каждом роуте.
  if (!force && roleCheckSettledToken === token) return;
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const me = await getProfile();
      const payload = decodeJwtPayload(readToken());
      let role = me?.role ?? payload?.role ?? null;

      // Клейм устарел (заявку одобрили, пока приложение было открыто) —
      // берём свежий accessToken с актуальной ролью.
      //
      // Только апгрейд BUYER → SELLER: именно этот переход делает
      // POST /users/become-seller (идемпотентно, требует APPROVED-заявку).
      // Понижение роли (админ вернул BUYER) звать нельзя — becomeSeller
      // молча вернул бы SELLER обратно по одобренной заявке.
      if (payload?.role === 'BUYER' && role === 'SELLER') {
        try {
          const fresh = await becomeSeller();
          if (fresh?.accessToken) {
            localStorage.setItem('accessToken', fresh.accessToken);
            role = fresh.user?.role ?? role;
          }
        } catch {
          // Не вышло (например, заявка ещё не одобрена) — UI всё равно
          // покажет серверную роль, повторный визит попробует снова.
        }
      }

      serverRole = role;
      serverRoleToken = readToken();
    } catch {
      // 401 обрабатывает interceptor (чистит токен и уводит на /login).
      // Сеть/5xx — оставляем состояние по токену.
    } finally {
      refreshInFlight = null;
      roleCheckSettledToken = readToken();
      emit();
    }
  })();

  return refreshInFlight;
}

export function useAuth() {
  // Подписка на смену токена: свой релогин, обновление токена из refreshAuth,
  // logout, изменения в другой вкладке.
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const token = readToken();

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
      emit();
    }
  }, [token, payload]);

  const expired = !!payload?.exp && payload.exp * 1000 < mountedAt;
  const tokenRole = !token || !payload || expired ? null : (payload.role ?? null);

  /**
   * BUG-2: серверная роль приоритетнее клейма, но только если она получена
   * для ТЕКУЩЕГО токена — иначе после релогина всплыла бы роль прошлого юзера.
   */
  const freshServerRole = serverRoleToken && serverRoleToken === token ? serverRole : null;
  const role = tokenRole ? (freshServerRole ?? tokenRole) : null;
  const id = !token || !payload || expired ? null : (payload.sub ?? null);
  const user = role ? { id, role } : null;

  /**
   * BUG-2: серверная роль ещё не проверена для текущего токена. Guard'у
   * нельзя редиректить по устаревшему клейму, пока проверка в пути.
   */
  const rolePending = !!token && !expired && roleCheckSettledToken !== token;

  return {
    user,
    role,
    rolePending,
    isAuthenticated: !!user,
    isAdmin: role === 'ADMIN',
    isSeller: role === 'SELLER',
    isBuyer: role === 'BUYER',
    /** Принудительный ре-фетч профиля с сервера (например, после заявки). */
    refresh: refreshAuth,
  };
}