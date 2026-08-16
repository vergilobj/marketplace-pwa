import { useEffect, useState, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Loader2, Clock, Flame, TrendingUp } from 'lucide-react';
import { getProducts } from '../api/products';
import ProductCard from '../components/ProductCard';
import { useAuth } from '../hooks/useAuth';

type SortType = 'newest' | 'popular' | 'price_asc' | 'price_desc';
const PAGE_SIZE = 20;

const sortOptions: { value: SortType; label: string; icon: React.ReactNode }[] = [
  { value: 'newest', label: 'Новые', icon: <Clock size={14} /> },
  { value: 'popular', label: 'Популярные', icon: <Flame size={14} /> },
  { value: 'price_asc', label: 'Дешевле', icon: <TrendingUp size={14} /> },
  { value: 'price_desc', label: 'Дороже', icon: <TrendingUp size={14} className="rotate-180" /> },
];

export default function ProductsPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sort, setSort] = useState<SortType>('newest');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const loaderRef = useRef<HTMLDivElement>(null);
  const { isSeller } = useAuth();

  const loadProducts = useCallback(async (pageNum: number, reset: boolean) => {
    if (reset) setLoading(true);
    else setLoadingMore(true);
    try {
      const res = await getProducts({ page: pageNum, limit: PAGE_SIZE, sort });
      if (reset) setProducts(res.items || []);
      else setProducts(prev => [...prev, ...(res.items || [])]);
      setHasMore(res.page < res.pages);
      setPage(pageNum + 1);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [sort]);

  useEffect(() => {
    setProducts([]);
    setPage(1);
    setHasMore(true);
    loadProducts(1, true);
  }, [sort, loadProducts]);

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

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold text-white">Товары</h1>
        <div className="flex items-center gap-2">
          {isSeller && (
            <Link to="/products/new" className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-500 text-white text-sm font-semibold hover:bg-indigo-400 transition-all shadow-lg shadow-indigo-500/25">
              <Plus size={16} /> Создать
            </Link>
          )}
          <div className="flex items-center gap-1 p-1 bg-white/[0.04] rounded-2xl">
            {sortOptions.map(opt => (
              <button key={opt.value} onClick={() => setSort(opt.value)} className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${sort === opt.value ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/25' : 'text-white/50 hover:text-white hover:bg-white/[0.06]'}`}>{opt.icon}{opt.label}</button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-2xl bg-[#1a1a24] border border-white/[0.06] overflow-hidden">
              <div className="skeleton h-40 w-full" />
              <div className="p-3 space-y-2">
                <div className="skeleton h-4 w-3/4 rounded-lg" />
                <div className="skeleton h-3 w-1/2 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      ) : products.length === 0 ? (
        <div className="text-center py-24">
          <p className="text-white/40 text-sm">Товары не найдены</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {products.map(p => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
          <div ref={loaderRef} className="py-10 flex justify-center">
            {loadingMore && <Loader2 size={24} className="animate-spin text-indigo-400" />}
            {!hasMore && !loadingMore && products.length > 0 && (
              <p className="text-white/30 text-sm">Все товары загружены</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
