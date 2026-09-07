import { useEffect, useState, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Loader2, Clock, Flame, TrendingUp, Package, Search, X } from 'lucide-react';
import { getProducts } from '../api/products';
import ProductCard from '../components/ProductCard';
import { useAuth } from '../hooks/useAuth';

type SortType = 'newest' | 'popular' | 'price_asc' | 'price_desc';
const PAGE_SIZE = 24;

const sortOptions: { value: SortType; label: string; icon: React.ReactNode }[] = [
  { value: 'newest', label: 'Свежее', icon: <Clock size={14} /> },
  { value: 'popular', label: 'Хайп', icon: <Flame size={14} /> },
  { value: 'price_asc', label: 'Дешевле', icon: <TrendingUp size={14} /> },
  { value: 'price_desc', label: 'Дороже', icon: <TrendingUp size={14} className="rotate-180" /> },
];

export default function ProductsPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sort, setSort] = useState<SortType>('newest');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const loaderRef = useRef<HTMLDivElement>(null);
  const { isSeller } = useAuth();

  const loadProducts = useCallback(async (pageNum: number, reset: boolean) => {
    if (reset) setLoading(true);
    else setLoadingMore(true);
    try {
      const res = await getProducts({ page: pageNum, limit: PAGE_SIZE, sort });
      const items = res.items || [];
      const filtered = search ? items.filter((p: any) => p.title?.toLowerCase().includes(search.toLowerCase())) : items;
      if (reset) { setProducts(filtered); }
      else setProducts(prev => [...prev, ...filtered]);
      setHasMore(res.page < res.pages);
      setPage(pageNum + 1);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [sort, search]);

  useEffect(() => {
    setProducts([]);
    setPage(1);
    setHasMore(true);
    loadProducts(1, true);
  }, [sort, search, loadProducts]);

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

  const filteredProducts = search
    ? products.filter(p => p.title?.toLowerCase().includes(search.toLowerCase()))
    : products;

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div className="fixed inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 60% 40% at 50% -5%, rgba(34,197,94,0.10) 0%, transparent 60%)'
      }} />

      <div className="relative max-w-3xl mx-auto px-4 sm:px-6 pt-10 pb-20">
        {/* Заголовок */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Товары</h1>
          {isSeller && (
            <Link to="/products/new" className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#22c55e] text-[#0d1512] text-sm font-bold hover:bg-[#16a34a] transition-colors">
              <Plus size={16} /> Выставить
            </Link>
          )}
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
              className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-colors shrink-0 ${
                sort === opt.value
                  ? 'bg-[#22c55e] text-[#0d1512]'
                  : 'text-[var(--color-muted)] border border-[var(--color-border)] hover:text-[var(--color-text)] hover:border-[#22c55e]/40'
              }`}
            >
              {opt.icon}{opt.label}
            </button>
          ))}
        </div>

        {/* Сетка */}
        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
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
            <div className="text-[var(--color-muted)] text-sm">Пока пусто. Здесь появится твой рынок.</div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
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