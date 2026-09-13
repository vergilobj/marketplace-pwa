import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/* ------------------------------------------------------------------------ */
/* HIGH-2: обновление access-токена вместо вылета на /login.                 */
/*                                                                           */
/* Было: любой 401 → removeItem('accessToken') + window.location.href =      */
/* '/login'. Access-токен живёт 15 минут, поэтому каждые 15 минут активный   */
/* пользователь терял корзину, форму и позицию скролла — при живом           */
/* refresh-токене на 7 дней.                                                 */
/*                                                                           */
/* Стало: 401 → POST /auth/refresh с refreshToken → повтор исходного запроса.*/
/* На /login уводим ТОЛЬКО если refresh тоже не сработал.                    */
/*                                                                           */
/* Три обязательных свойства:                                                */
/*  1. Защита от рекурсии — сам запрос на refresh (и повторный запрос с      */
/*     обновлённым токеном) помечается `_retried`/`_isRefresh` и второй раз  */
/*     в refresh не уходит. Иначе бесконечный цикл при мёртвом refresh.      */
/*  2. Single-flight — параллельные 401 не порождают N рефрешей: все ждут    */
/*     ОДИН промис (`refreshInFlight`). Пять запросов, упавших одновременно, */
/*     дают ровно один POST /auth/refresh.                                   */
/*  3. Ротация — эндпоинт возвращает НОВУЮ ПАРУ, сохраняем оба токена.       */
/*     Если бэкенд отдаёт только accessToken (ротации нет) — refreshToken    */
/*     остаётся прежним, и это по-прежнему рабочий сценарий.                 */
/* ------------------------------------------------------------------------ */

/** Единственный «в полёте» запрос на обновление — общий для всех 401. */
let refreshInFlight: Promise<string> | null = null;

/** Refresh-токен, для которого обновление уже провалилось — не долбим повторно. */
let refreshFailedFor: string | null = null;

type RetriableConfig = {
  headers?: Record<string, unknown>;
  _retried?: boolean;
  _isRefresh?: boolean;
};

function clearTokens(): void {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
}

/** Уводит на /login, не дублируя навигацию, если мы уже там. */
function redirectToLogin(): void {
  if (window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
}

/**
 * Один общий запрос обновления пары токенов.
 *
 * axios вызывается «сырой» (не через `api`), чтобы запрос на refresh
 * гарантированно не прошёл через этот же interceptor.
 */
function refreshTokens(refreshToken: string): Promise<string> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = axios
    .post('/api/auth/refresh', { refreshToken })
    .then((res) => {
      const accessToken: string | undefined = res.data?.accessToken;
      if (!accessToken) throw new Error('refresh: no accessToken in response');
      localStorage.setItem('accessToken', accessToken);
      // Ротация: сохраняем и новый refresh, если он пришёл.
      if (typeof res.data?.refreshToken === 'string' && res.data.refreshToken) {
        localStorage.setItem('refreshToken', res.data.refreshToken);
      }
      refreshFailedFor = null;
      return accessToken;
    })
    .finally(() => {
      refreshInFlight = null;
    });

  return refreshInFlight;
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error.response?.status;
    const config = error.config as RetriableConfig | undefined;

    if (status !== 401 || !config) {
      return Promise.reject(error);
    }

    // Сам refresh упал 401 — обновляться больше нечем.
    if (config._isRefresh) {
      clearTokens();
      redirectToLogin();
      return Promise.reject(error);
    }

    // Повтор уже делали и снова 401 — токен обновлён, но прав всё равно нет.
    if (config._retried) {
      clearTokens();
      redirectToLogin();
      return Promise.reject(error);
    }

    const refreshToken = localStorage.getItem('refreshToken');
    if (!refreshToken) {
      // Гость или refresh уже вычищен — refresh невозможен.
      clearTokens();
      redirectToLogin();
      return Promise.reject(error);
    }

    // Для этого refresh-токена обновление уже провалилось — не зацикливаемся.
    if (refreshFailedFor === refreshToken) {
      clearTokens();
      redirectToLogin();
      return Promise.reject(error);
    }

    try {
      const accessToken = await refreshTokens(refreshToken);
      config._retried = true;
      config.headers = { ...(config.headers ?? {}), Authorization: `Bearer ${accessToken}` };
      return api.request(config as never);
    } catch (refreshError) {
      refreshFailedFor = refreshToken;
      clearTokens();
      redirectToLogin();
      return Promise.reject(refreshError);
    }
  },
);

export default api;