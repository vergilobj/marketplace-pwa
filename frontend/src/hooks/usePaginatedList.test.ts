import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePaginatedList } from './usePaginatedList';

/**
 * L2: тесты общего хука постраничной загрузки.
 *
 * Проверяем именно то, ради чего хук писался: страницы клеятся, дубликаты
 * (OFFSET без уникального tiebreaker'а) отбрасываются, признак «есть ещё»
 * выводится из длины страницы, а номер следующей страницы не сбивается после
 * ручной догрузки. Живой тест на 31 товаре вторую страницу не открывает,
 * поэтому граница страницы проверяется здесь.
 */

// jsdom не имеет IntersectionObserver — без заглушки хук падает на монтировании.
class IO {
  cb: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) { this.cb = cb; }
  observe() { /* noop: догрузку зовём руками через loadMore */ }
  disconnect() { /* noop */ }
  unobserve() { /* noop */ }
  takeRecords() { return []; }
  root = null;
  rootMargin = '';
  thresholds = [];
}
Object.defineProperty(globalThis, 'IntersectionObserver', { value: IO, writable: true });

type Row = { id: string; v: number };

const PAGE = 2;

const makeRows = (start: number, count: number): Row[] =>
  Array.from({ length: count }, (_, i) => ({ id: `id-${start + i}`, v: start + i }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('usePaginatedList', () => {
  it('грузит первую страницу и считает hasMore по длине страницы', async () => {
    const fetchPage = vi.fn(async ({ page }: { page: number; limit: number }) =>
      page === 1 ? makeRows(0, PAGE) : [],
    );

    const { result } = renderHook(() => usePaginatedList<Row>(fetchPage, PAGE));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith({ page: 1, limit: PAGE });
    expect(result.current.items).toEqual(makeRows(0, PAGE));
    // страница полная → возможно есть следующая
    expect(result.current.hasMore).toBe(true);
  });

  it('неполная страница гасит hasMore и выключает догрузку', async () => {
    const fetchPage = vi.fn(async () => makeRows(0, 1));

    const { result } = renderHook(() => usePaginatedList<Row>(fetchPage, PAGE));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.hasMore).toBe(false);

    await act(async () => { result.current.loadMore(); });

    // второй запрос не ушёл
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(result.current.loadingMore).toBe(false);
  });

  it('догружает вторую страницу и склеивает с первой', async () => {
    const fetchPage = vi.fn(async ({ page }: { page: number; limit: number }) =>
      page === 1 ? makeRows(0, PAGE) : page === 2 ? makeRows(PAGE, PAGE) : [],
    );

    const { result } = renderHook(() => usePaginatedList<Row>(fetchPage, PAGE));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { result.current.loadMore(); });
    await waitFor(() => expect(result.current.loadingMore).toBe(false));

    expect(fetchPage).toHaveBeenNthCalledWith(2, { page: 2, limit: PAGE });
    expect(result.current.items.map(r => r.id)).toEqual(['id-0', 'id-1', 'id-2', 'id-3']);
    expect(result.current.hasMore).toBe(true);
  });

  it('отбрасывает дубликаты при пересечении соседних страниц', async () => {
    // бэкенд отдаёт страницы через OFFSET без tiebreaker'а — пересечение реально
    const fetchPage = vi.fn(async ({ page }: { page: number; limit: number }) =>
      page === 1 ? makeRows(0, PAGE) : makeRows(PAGE - 1, PAGE),
    );

    const { result } = renderHook(() => usePaginatedList<Row>(fetchPage, PAGE));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { result.current.loadMore(); });
    await waitFor(() => expect(result.current.loadingMore).toBe(false));

    // id-1 пришёл и на первой, и на второй странице — остаётся один
    expect(result.current.items.map(r => r.id)).toEqual(['id-0', 'id-1', 'id-2']);
  });

  it('третья страница запрашивается с номером 3, а не 2', async () => {
    const fetchPage = vi.fn(async ({ page }: { page: number; limit: number }) =>
      makeRows((page - 1) * PAGE, PAGE),
    );

    const { result } = renderHook(() => usePaginatedList<Row>(fetchPage, PAGE));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { result.current.loadMore(); });
    await waitFor(() => expect(result.current.loadingMore).toBe(false));
    await act(async () => { result.current.loadMore(); });
    await waitFor(() => expect(result.current.loadingMore).toBe(false));

    expect(fetchPage).toHaveBeenNthCalledWith(3, { page: 3, limit: PAGE });
    expect(result.current.items).toHaveLength(6);
  });

  it('reset перечитывает первую страницу вместо накопления', async () => {
    const fetchPage = vi.fn(async ({ page }: { page: number; limit: number }) =>
      page === 1 ? makeRows(0, PAGE) : makeRows(PAGE, PAGE),
    );

    const { result } = renderHook(() => usePaginatedList<Row>(fetchPage, PAGE));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { result.current.loadMore(); });
    await waitFor(() => expect(result.current.loadingMore).toBe(false));
    expect(result.current.items).toHaveLength(4);

    await act(async () => { result.current.reset(); });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.items).toEqual(makeRows(0, PAGE));
  });

  it('enabled=false не делает ни одного запроса', async () => {
    const fetchPage = vi.fn(async () => makeRows(0, PAGE));

    const { result } = renderHook(() => usePaginatedList<Row>(fetchPage, PAGE, false));

    await act(async () => { await Promise.resolve(); });

    expect(fetchPage).not.toHaveBeenCalled();
    expect(result.current.items).toEqual([]);
  });
});