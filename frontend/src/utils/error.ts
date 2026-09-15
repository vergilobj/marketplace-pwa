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
 * Вырезает `message` из ответа бэкенда: строку, либо первый элемент массива
 * (class-validator отдаёт строку[], а не строку).
 *
 * Отсюда же берёт текст таблица переводов: 400 от DTO приходит массивом
 * «description must be shorter than or equal to 2000 characters».
 */
export function backendMessage(err: unknown): string | null {
  if (!axios.isAxiosError(err)) return null;
  const data = err.response?.data as { message?: unknown } | undefined;
  if (data && typeof data.message === 'string' && data.message) return data.message;
  if (data && Array.isArray(data.message) && data.message.length > 0) {
    const first = data.message[0];
    if (typeof first === 'string' && first) return first;
  }
  return null;
}

/**
 * B1: сырой английский `class-validator` нельзя показывать пользователю.
 *
 * «description must be shorter than or equal to 2000 characters» в форме
 * создания товара — это текст для разработчика. Таблица переводит типовые
 * шаблоны (регистронезависимо) на русский, сохраняя числа и перечисления.
 *
 * Незнакомый текст возвращается как есть — поля без своего сообщения в DTO
 * (например `link must be a URL address`) остаются читаемыми.
 */
export function humanizeBackendMessage(message: string): string {
  const raw = message.trim();
  if (!raw) return raw;

  // «must be shorter than or equal to 2000 characters»
  const maxLen = raw.match(/must be shorter than or equal to (\d+) characters?/i);
  if (maxLen) return `Слишком длинно: максимум ${maxLen[1]} символов`;

  // «must be longer than or equal to 6 characters»
  const minLen = raw.match(/must be longer than or equal to (\d+) characters?/i);
  if (minLen) return `Слишком коротко: минимум ${minLen[1]} символов`;

  if (/should not be empty/i.test(raw)) return 'Заполни это поле';
  if (/must be a string/i.test(raw)) return 'Ожидается текст';

  // Порядок важен: `integer number` не должен перехватываться правилом `number`.
  if (/must be an integer number/i.test(raw)) return 'Ожидается целое число';
  if (/must be a number/i.test(raw)) return 'Ожидается число';

  // «must be one of: SUGGESTION, BUG, OTHER»
  const oneOf = raw.match(/must be one of:?\s*(.+)$/i);
  if (oneOf) {
    const allowed = oneOf[1]
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    if (allowed.length > 0) return `Недопустимое значение. Разрешено: ${allowed.join(', ')}`;
  }

  if (/must be a boolean value/i.test(raw)) return 'Ожидается да/нет';

  return raw;
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
 * Текст бэкенда проходит через таблицу переводов `humanizeBackendMessage`.
 * Сетевой сбой, 429 и 5xx обрабатываются ДО неё и не меняются.
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

    const backend = backendMessage(err);
    if (backend) return humanizeBackendMessage(backend);
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export default errorMessage;