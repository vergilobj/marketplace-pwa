import axios from 'axios';

/** Человеческое сообщение для 429 (ThrottlerException: Too Many Requests). */
export const TOO_MANY_REQUESTS_MESSAGE = 'Слишком много попыток. Подожди минуту и попробуй снова';

/** Код HTTP-ошибки из неизвестного исключения (0 — сеть недоступна). */
export function errorStatus(err: unknown): number | null {
  if (axios.isAxiosError(err)) {
    if (err.response?.status) return err.response.status;
    // Запрос ушёл, но ответа нет (оффлайн/DNS/таймаут) — сетевой сбой.
    if (err.request) return 0;
  }
  return null;
}

/**
 * HIGH-3: 429 (и прочие «серверные» коды) не должны показывать юзеру
 * сырой текст класса исключения бэкенда.
 *
 * `ThrottlerException: Too Many Requests` в форме входа — это сообщение для
 * разработчика, а не для человека, который пять раз ошибся паролем.
 */
function humanizeStatus(status: number): string | null {
  if (status === 429) return TOO_MANY_REQUESTS_MESSAGE;
  if (status >= 500) return 'Сервер прилёг. Попробуй ещё раз через минуту';
  return null;
}

/**
 * Достаёт человекочитаемое сообщение из неизвестной ошибки.
 *
 * Порядок: известный HTTP-код (429/5xx) → ответ бэкенда (`{ message }`) →
 * текст Error → фолбэк.
 *
 * Используется в catch-блоках вместо нетипизированного перехвата:
 * `catch (err: unknown) { setError(errorMessage(err, 'Ошибка')); }`
 */
export function errorMessage(err: unknown, fallback = 'Ошибка'): string {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;

    // Сетевой сбой: ответа нет вообще.
    if (!status && err.request) {
      return 'Нет связи с сервером. Проверь интернет и попробуй снова';
    }

    // 429/5xx важнее текста бэкенда: там лежит имя класса исключения.
    if (status) {
      const human = humanizeStatus(status);
      if (human) return human;
    }

    const data = err.response?.data as { message?: unknown } | undefined;
    if (data && typeof data.message === 'string' && data.message) {
      return data.message;
    }
    // message может прийти массивом (class-validator отдаёт строку[], а не строку)
    if (data && Array.isArray(data.message) && data.message.length > 0) {
      const first = data.message[0];
      if (typeof first === 'string' && first) return first;
    }
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export default errorMessage;