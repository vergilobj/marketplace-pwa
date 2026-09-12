import { useCallback, useEffect, useRef, useState } from 'react';
import { mergeUniqueById } from '../utils/mergeUnique';

/**
 * L2: общий хук постраничной загрузки для списков, которые бэкенд отдаёт
 * КАК МАССИВ (без total/pages) — заявки на вывод, лиды, инвайты, комментарии.
 *
 * Почему так, а не как в `ProductsPage`: тот эндпоинт (`/products`) возвращает
 * `{ items, total, page, pages }`, поэтому infinite scroll там знает `hasMore`
 * точно. Здесь конверта нет — форма ответа зафиксирована бэкендом (L1 не менял),
 * поэтому «есть ещё» выводится из длины страницы: полная страница ⇒ возможно
 * есть следующая. Последняя (неполная) страница гасит флаг, лишний запрос
 * уходит только если количество записей кратно PAGE_SIZE.
 *
 * Особенности:
 *  - `items` — только «серверные» записи, без оптимистичных вставок (страницы
 *    клеятся, локальные правки делает вызывающая страница);
 *  - слияние через `mergeUniqueById` — OFFSET-пагинация без уникального
 *    tiebreaker'а может дать пересечение соседних страниц;
 *  - первый запрос уходит из эффекта в `.then` (без синхронного setState в теле
 *    эффекта), поэтому `react-hooks/set-state-in-effect` не срабатывает;
 *  - `rootMargin` — как в `ProductsPage` (200px).
 */

type Fetcher<T> = (params: { page: number; limit: number }) => Promise<T[]>;

export interface PaginatedList<T> {
  items: T[];
  setItems: React.Dispatch<React.SetStateAction<T[]>>;
  /** Первая страница ещё не пришла — показывать скелетон. */
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  /** Ручная догрузка (кнопка «Показать ещё»). */
  loadMore: () => void;
  /** Ref-«маячок» для IntersectionObserver: <div ref={loaderRef} />. */
  loaderRef: React.RefObject<HTMLDivElement | null>;
  /** Перечитать с первой страницы (после approve/reject и т.п.). */
  reset: () => void;
  /** Инкремент — триггер `reset` из эффекта (без setState в теле эффекта). */
  reload: () => void;
}

export function usePaginatedList<T extends { id: string }>(
  fetchPage: Fetcher<T>,
  pageSize: number,
  enabled = true,
): PaginatedList<T> {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const loaderRef = useRef<HTMLDivElement>(null);

  // fetchPage вызывающих страниц объявлен инлайн и меняется каждый рендер;
  // держим его в ref, чтобы эффект зависел только от [enabled, reloadKey].
  const fetcherRef = useRef(fetchPage);
  useEffect(() => {
    fetcherRef.current = fetchPage;
  }, [fetchPage]);

  const load = useCallback(
    async (pageNum: number) => {
      const data = await fetcherRef.current({ page: pageNum, limit: pageSize });
      const rows = Array.isArray(data) ? data : [];
      if (pageNum === 1) setItems(rows);
      else setItems((prev) => mergeUniqueById(prev, rows));
      setHasMore(rows.length === pageSize);
      setLoadingMore(false);
    },
    [pageSize],
  );

  const pageRef = useRef(1);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetcherRef
      .current({ page: 1, limit: pageSize })
      .then((data) => {
        if (cancelled) return;
        const rows = Array.isArray(data) ? data : [];
        setItems(rows);
        setHasMore(rows.length === pageSize);
        pageRef.current = 2;
      })
      .catch((e) => {
        if (cancelled) return;
        console.error('paginated list load failed', e);
        setItems([]);
        setHasMore(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, pageSize, reloadKey]);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore) return;
    setLoadingMore(true);
    const next = pageRef.current;
    pageRef.current = next + 1;
    void load(next).catch((e) => {
      console.error('paginated list loadMore failed', e);
      pageRef.current = next; // откатываем номер, чтобы не потерять страницу
      setLoadingMore(false);
    });
  }, [loading, loadingMore, hasMore, load]);

  const reload = useCallback(() => {
    setLoading(true);
    setLoadingMore(false);
    pageRef.current = 1;
    setReloadKey((k) => k + 1);
  }, []);

  useEffect(() => {
    const el = loaderRef.current;
    if (!el || !enabled) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !loading && !loadingMore && hasMore) {
          loadMore();
        }
      },
      { rootMargin: '200px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [enabled, loading, loadingMore, hasMore, loadMore]);

  return {
    items,
    setItems,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    loaderRef,
    reset: reload,
    reload,
  };
}

export default usePaginatedList;