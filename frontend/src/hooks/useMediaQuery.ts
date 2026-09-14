import { useEffect, useState } from 'react';

/**
 * Подписка на CSS media query из JS.
 *
 * Нужна для «вездесущей» плавающей кнопки консультанта: на мобиле страница
 * товара имеет собственную нижнюю панель действий (fixed, bottom 76px), над
 * которой кнопка оказалась бы поверх «Купить». На десктопе такой панели нет.
 *
 * SSR/jsdom: если `matchMedia` недоступен — возвращаем `false` (мобильное
 * поведение безопаснее: кнопку просто не показываем там, где конфликт).
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    // Safari < 14 понимает только addListener/removeListener.
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, [query]);

  return matches;
}

export default useMediaQuery;