import { useEffect, useState } from 'react';

/**
 * Debounce значения (R10). Поиск не уходит на сервер на каждый символ —
 * только после паузы ввода.
 */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);

  return debounced;
}

export default useDebounced;