import { useEffect, useState, useRef, useCallback } from 'react';
import { Loader2, Clock, Flame, TrendingUp, Package, Search, X } from 'lucide-react';
import { getProducts } from '../api/products';
import ProductCard from '../components/ProductCard';
import { CreateMenu } from '../components/CreateMenu';
import { formatPrice } from '../utils/format';
import { mergeUniqueById } from '../utils/mergeUnique';
import { useDebounced } from '../hooks/useDebounced';

type SortType = 'newest' | 'popular' | 'price_asc' | 'price_desc';
const PAGE_SIZE = 24;

/** Ключ «какой набор фильтров соответствует текущим данным». */
const productsKey = (s: SortType, q: string) => `${s}\u0000${q}`;

const sortOptions: { value: SortType; label: string; icon: React.ReactNode }[] = [
  { value: 'newest', label: 'Свежее', icon: <Clock size={14} /> },
  { value: 'popular', label: 'Хайп', icon: <Flame size={14} /> },
  { value: 'price_asc', label: 'Дешевле', icon: <TrendingUp size={14} /> },
  { value: 'price_desc', label: 'Дороже', icon: <TrendingUp size={14} className="rotate-180" /> },
];

export default function ProductsPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sort, setSort] = useState<SortType>('newest');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  // Скелетон — производное: фильтры разошлись с загруженным набором (dataKey).
  const [dataKey, setDataKey] = useState<string | null>(null);
  const loaderRef = useRef<HTMLDivElement>(null);

  // R10: поиск уходит на сервер, а не фильтрует первые 24 загруженных записи
  const debouncedSearch = useDebounced(search, 300);
  const queryKey = productsKey(sort, debouncedSearch);
  const loading = dataKey !== queryKey;

  const loadProducts = useCallback(async (pageNum: number, reset: boolean) => {
    if (!reset) setLoadingMore(true);
    try {
      const res = await getProducts({
        page: pageNum,
        limit: PAGE_SIZE,
        sort,
        search: debouncedSearch.trim() || undefined,
      });
      const items = res.items || [];
      if (reset) { setProducts(items); }
      else setProducts(prev => mergeUniqueById(prev, items));
      setHasMore(res.page < res.pages);
      setPage(pageNum + 1);
    } finally {
      setLoadingMore(false);
    }
  }, [sort, debouncedSearch]);

  // Смена фильтра/поиска → новая выдача с первой страницы.
  // Запрос уходит из эффекта, state-апдейты — в .then/.finally: синхронного
  // setState в теле эффекта нет. Пока dataKey не догонит queryKey, скелетон
  // показывается сам (loading — производное), сбрасывать состояние не нужно.
  useEffect(() => {
    const key = productsKey(sort, debouncedSearch);
    let cancelled = false;
    getProducts({
      page: 1,
      limit: PAGE_SIZE,
      sort,
      search: debouncedSearch.trim() || undefined,
    })
      .then((res) => {
        if (cancelled) return;
        setProducts(res.items || []);
        setHasMore(res.page < res.pages);
        setPage(2);
      })
      .catch((e) => {
        console.error('Failed to load products', e);
      })
      .finally(() => {
        // Набор помечается обработанным даже при ошибке — иначе скелетон зависнет.
        if (!cancelled) setDataKey(key);
      });
    return () => {
      cancelled = true;
    };
  }, [sort, debouncedSearch]);

  useEffect(() => {
    const el = loaderRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !loading && !loadingMore && hasMore) {
          loadProducts(page, false);
        }
      },
      { rootMargin: '200px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loading, loadingMore, hasMore, page, loadProducts]);

  // Результаты приходят уже отфильтрованными на сервере
  const filteredProducts = products;

  // Диапазон цен каталога — единый формат (R22)
  const priceRange = (() => {
    const prices = filteredProducts
      .map(p => Number(p.price))
      .filter(n => Number.isFinite(n));
    if (prices.length === 0) return '';
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return min === max ? formatPrice(min) : `${formatPrice(min)} – ${formatPrice(max)}`;
  })();

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div className="fixed inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 60% 40% at 50% -5%, rgba(34,197,94,0.10) 0%, transparent 60%)'
      }} />

      {/* Ширина каноническая для проекта (max-w-5xl) — совпадает с шапкой и футером в Layout. */}
      <div className="relative max-w-5xl mx-auto px-4 sm:px-6 pt-10 pb-20">
        {/* Заголовок */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-[var(--color-text)]">Товары</h1>
            {priceRange && (
              <p className="text-[11px] text-[var(--color-muted)] mt-1">Цены в каталоге: {priceRange}</p>
            )}
          </div>
          <CreateMenu variant="button" label="Выставить" />
        </div>

        {/* Поиск */}
        <div className="mb-5">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Искать среди товаров…"
              className="w-full pl-10 pr-10 py-3 rounded-xl bg-[var(--color-surface)] text-[var(--color-text)] text-sm outline-none border border-[var(--color-border)] focus:border-[#22c55e] transition-colors"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)] hover:text-[var(--color-text)]">
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Сортировка — капсулы как на главной */}
        <div className="mb-6 flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
          {sortOptions.map(opt => (
            <button
              key={opt.value}
              onClick={() => setSort(opt.value)}
              className={`flex items-center gap-1.5 px-4 min-h-[44px] rounded-full text-xs font-bold whitespace-nowrap transition-colors shrink-0 ${
                sort === opt.value
                  ? 'bg-[#22c55e] text-[#0d1512]'
                  : 'text-[var(--color-muted)] border border-[var(--color-border)] hover:text-[var(--color-text)] hover:border-[#22c55e]/40'
              }`}
            >
              {opt.icon}{opt.label}
            </button>
          ))}
        </div>

        {/* Сетка — адаптивная: 2 / 3 / 4 колонки */}
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-2xl bg-[var(--color-surface)] overflow-hidden">
                <div className="h-36 bg-[var(--bg-3)] animate-pulse" />
                <div className="p-3 space-y-2">
                  <div className="h-4 w-3/4 rounded-lg bg-[var(--bg-3)] animate-pulse" />
                  <div className="h-3 w-1/2 rounded-lg bg-[var(--bg-3)] animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="text-center py-24">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[var(--color-surface)] flex items-center justify-center">
              <Package size={28} className="text-[var(--color-faint)]" />
            </div>
            <div className="text-[var(--color-muted)] text-sm">
              {search ? 'Ничего не нашли по запросу.' : 'Пока пусто. Здесь появится твой рынок.'}
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
              {filteredProducts.map(p => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
            <div ref={loaderRef} className="py-10 flex justify-center">
              {loadingMore && <Loader2 size={22} className="animate-spin text-[#22c55e]" />}
              {!hasMore && !loadingMore && filteredProducts.length > 0 && (
                <div className="text-[var(--color-faint)] text-xs">Всё показали</div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}