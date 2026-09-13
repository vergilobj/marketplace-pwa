import { useCallback, useState } from 'react';

/**
 * HIGH-1: сетевой сбой не должен выглядеть как «товаров нет».
 *
 * До этого списки в `.catch` только писали `console.error`, а UI оставался в
 * состоянии «пусто»: юзер видел «Пока пусто. Здесь появится твой рынок» и
 * думал, что товаров нет, вместо «не загрузилось, повтори».
 *
 * Хук держит текст ошибки и `retryKey`. Страница кладёт `retryKey` в
 * зависимости эффекта загрузки — «Повторить» перезапускает запрос без
 * перезагрузки страницы.
 *
 * Использование:
 * ```tsx
 * const { error, setError, retryKey, errorProps } = useListError();
 *
 * useEffect(() => { ... .catch((e) => setError(errorMessage(e, 'Не удалось загрузить'))) }, [retryKey]);
 *
 * {error
 *   ? <ErrorState {...errorProps} />
 *   : items.length === 0 ? <EmptyState .../> : <List />}
 * ```
 */
export function useListError() {
  const [error, setErrorState] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  const setError = useCallback((message: string) => setErrorState(message), []);
  const clearError = useCallback(() => setErrorState(''), []);

  /**
   * «Повторить» — инкремент ключа. Страница кладёт его в зависимости эффекта
   * загрузки, поэтому повторный запрос уходит без перезагрузки страницы.
   *
   * Текст ошибки НЕ сбрасывается: ErrorState остаётся на экране до успешного
   * ответа (страница вызывает `setError('')` в `.then`). Иначе между кликом и
   * ответом мелькало бы пустое состояние — ровно тот баг, который чиним.
   */
  const onRetry = useCallback(() => {
    setRetryKey((k) => k + 1);
  }, []);

  return {
    /** Текст ошибки. Пустая строка — ошибки нет. */
    error,
    setError,
    clearError,
    /** Инкремент при «Повторить» — в зависимости эффекта загрузки. */
    retryKey,
    /** Готовые пропсы для `<ErrorState {...errorProps} />`. */
    errorProps: {
      message: error,
      description: 'Не получилось загрузить. Проверь связь и попробуй ещё раз.',
      onRetry,
    },
  };
}

export default useListError;