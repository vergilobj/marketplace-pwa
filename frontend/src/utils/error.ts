import axios from 'axios';

/**
 * Достаёт человекочитаемое сообщение из неизвестной ошибки.
 *
 * Порядок: ответ бэкенда (`{ message }`) → текст Error → фолбэк.
 * Используется в catch-блоках вместо нетипизированного перехвата:
 * `catch (err: unknown) { setError(errorMessage(err, 'Ошибка')); }`
 */
export function errorMessage(err: unknown, fallback = 'Ошибка'): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { message?: unknown } | undefined;
    if (data && typeof data.message === 'string' && data.message) {
      return data.message;
    }
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export default errorMessage;