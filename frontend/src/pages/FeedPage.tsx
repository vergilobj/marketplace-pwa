import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { getFeed } from '../api/posts';
import { getProducts } from '../api/products';
import PostCard from '../components/PostCard';
import ProductCard from '../components/ProductCard';
import { Search, X, Sparkles, FileText, Grid3X3, Megaphone, Clock, Flame, TrendingUp, List, ArrowRight, Zap, Loader2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import api from '../api/axios';
import toast from 'react-hot-toast';

type SortType = 'newest' | 'popular' | 'price_asc' | 'price_desc';
type TabType = 'all' | 'posts' | 'products' | 'ads';

const sortOptions: { value: SortType; label: string; icon: React.ReactNode }[] = [
  { value: 'newest', label: 'Новые', icon: <Clock size={13} /> },
  { value: 'popular', label: 'Популярные', icon: <Flame size={13} /> },
  { value: 'price_asc', label: 'Дешевле', icon: <TrendingUp size={13} /> },
  { value: 'price_desc', label: 'Дороже', icon: <TrendingUp size={13} className="rotate-180" /> },
];

const PAGE_SIZE = 20;

export default function FeedPage() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const { isAdmin, isSeller, isAuthenticated } = useAuth();
  const [posts, setPosts] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [sort, setSort] = useState<SortType>('newest');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [search, setSearch] = useState(() => sp.get('search') || '');
  
  // Pagination state
  const [postsPage, setPostsPage] = useState(1);
  const [productsPage, setProductsPage] = useState(1);
  const [hasMorePosts, setHasMorePosts] = useState(true);
  const [hasMoreProducts, setHasMoreProducts] = useState(true);
  const loaderRef = useRef<HTMLDivElement>(null);

  // Reset on sort/tab change
  useEffect(() => {
    setPosts([]);
    setProducts([]);
    setPostsPage(1);
    setProductsPage(1);
    setHasMorePosts(true);
    setHasMoreProducts(true);
    setLoading(true);
    loadInitial();
  }, [sort, activeTab]);

  const loadInitial = async () => {
    try {
      const [postRes, prodRes] = await Promise.all([
        getFeed({ page: 1, limit: PAGE_SIZE, sort }),
        getProducts({ page: 1, limit: PAGE_SIZE, sort: sort === 'price_asc' ? 'price_asc' : sort === 'price_desc' ? 'price_desc' : sort === 'popular' ? 'popular' : 'newest' }),
      ]);
      setPosts(postRes.items || []);
      setProducts(prodRes.items || []);
      setHasMorePosts(postRes.page < postRes.pages);
      setHasMoreProducts(prodRes.page < prodRes.pages);
      setPostsPage(2);
      setProductsPage(2);
    } catch (e) {
      console.error('Failed to load feed', e);
    } finally {
      setLoading(false);
    }
  };

  const loadMore = useCallback(async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const isPostTab = activeTab === 'posts' || activeTab === 'ads';
      const isProductTab = activeTab === 'products';
      
      if ((isPostTab || activeTab === 'all') && hasMorePosts) {
        const res = await getFeed({ page: postsPage, limit: PAGE_SIZE, sort });
        setPosts(prev => [...prev, ...(res.items || [])]);
        setHasMorePosts(res.page < res.pages);
        setPostsPage(p => p + 1);
      }
      if ((isProductTab || activeTab === 'all') && hasMoreProducts) {
        const res = await getProducts({ page: productsPage, limit: PAGE_SIZE, sort: sort === 'price_asc' ? 'price_asc' : sort === 'price_desc' ? 'price_desc' : sort === 'popular' ? 'popular' : 'newest' });
        setProducts(prev => [...prev, ...(res.items || [])]);
        setHasMoreProducts(res.page < res.pages);
        setProductsPage(p => p + 1);
      }
    } catch (e) {
      console.error('Failed to load more', e);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, activeTab, sort, postsPage, productsPage, hasMorePosts, hasMoreProducts]);

  // Intersection Observer
  useEffect(() => {
    const el = loaderRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !loading && !loadingMore) {
          const canLoadMore = activeTab === 'all' ? (hasMorePosts || hasMoreProducts) : activeTab === 'products' ? hasMoreProducts : hasMorePosts;
          if (canLoadMore) loadMore();
        }
      },
      { rootMargin: '200px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loading, loadingMore, hasMorePosts, hasMoreProducts, activeTab, loadMore]);

  const delPost = async (id: string) => {
    if (!confirm('Удалить?')) return;
    try { await api.delete('/posts/' + id); setPosts(p => p.filter(x => x.id !== id)); toast.success('Удалён'); } catch { toast.error('Ошибка'); }
  };

  // Client-side search filter (fast, no API call)
  const fp = posts.filter(p => p.title?.toLowerCase().includes(search.toLowerCase()) || p.content?.toLowerCase().includes(search.toLowerCase()));
  const fpr = products.filter(p => p.title?.toLowerCase().includes(search.toLowerCase()));
  
  const ads = fp.filter(p => p.isAd);
  const regular = fp.filter(p => !p.isAd);

  const items = (() => {
    switch (activeTab) {
      case 'posts': return regular.map(p => ({ ...p, type: 'post' }));
      case 'products': return fpr.map(p => ({ ...p, type: 'product' }));
      case 'ads': return ads.map(p => ({ ...p, type: 'post' }));
      default: return [...ads.map(p => ({ ...p, type: 'post' })), ...regular.map(p => ({ ...p, type: 'post' })), ...fpr.map(p => ({ ...p, type: 'product' }))];
    }
  })();

  const showLoader = activeTab === 'all' ? (hasMorePosts || hasMoreProducts) : activeTab === 'products' ? hasMoreProducts : hasMorePosts;

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      {/* Hero */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden rounded-3xl mb-10 p-6 sm:p-10 bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500">
        <div className="absolute inset-0 bg-black/20" />
        <div className="absolute top-0 right-0 w-80 h-80 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/4" />
        <div className="absolute bottom-0 left-1/4 w-64 h-64 bg-purple-400/20 rounded-full blur-3xl" />
        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/15 backdrop-blur-sm text-white/90 text-sm font-medium mb-6"><Zap size={14} className="text-yellow-300" /> Закрытый маркетплейс</div>
          <h1 className="text-xl xs:text-2xl sm:text-3xl lg:text-4xl font-extrabold text-white mb-3 tracking-tight leading-[1.15]">Покупайте и продавайте в надёжном сообществе</h1>
          <p className="text-white/70 text-base max-w-lg mb-5">Закрытая площадка для проверенных участников. Товары, чат, реферальная программа — всё в одном месте.</p>
          <div className="flex flex-wrap gap-3">
            {isSeller && <button onClick={() => navigate('/products/new')} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-slate-900 font-semibold text-sm hover:bg-white/90 transition-all shadow-xl"><Sparkles size={16} /> Выставить товар</button>}
            {isAdmin && <button onClick={() => navigate('/posts/new')} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/15 backdrop-blur-sm text-white font-semibold text-sm border border-white/20 hover:bg-white/25 transition-all"><FileText size={16} /> Новый пост</button>}
            {!isAuthenticated && <button onClick={() => navigate('/register')} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-slate-900 font-semibold text-sm hover:bg-white/90 transition-all shadow-xl">Присоединиться <ArrowRight size={16} /></button>}
          </div>
        </div>
      </motion.div>

      {/* Unified Toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-6">
        <div className="relative flex-1 w-full">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/35" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по ленте..." className="w-full pl-11 pr-10 py-3 rounded-2xl bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder:text-white/25 outline-none focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/10 transition-all" />
          {search && <button onClick={() => setSearch('')} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/35 hover:text-white/70 transition-colors"><X size={16} /></button>}
        </div>
        <div className="flex items-center gap-1.5 p-1 bg-white/[0.04] rounded-2xl overflow-x-auto flex-nowrap max-w-full">
          {sortOptions.map(opt => (
            <button key={opt.value} onClick={() => setSort(opt.value)} className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold transition-all whitespace-nowrap ${sort === opt.value ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/25' : 'text-white/50 hover:text-white hover:bg-white/[0.06]'}`}>{opt.icon}{opt.label}</button>
          ))}
        </div>
        <div className="flex items-center gap-1 p-1 bg-white/[0.04] rounded-2xl shrink-0">
          <button onClick={() => setViewMode('grid')} className={`p-2 rounded-xl transition-all ${viewMode === 'grid' ? 'bg-white/[0.08] text-white' : 'text-white/35 hover:text-white'}`}><Grid3X3 size={15} /></button>
          <button onClick={() => setViewMode('list')} className={`p-2 rounded-xl transition-all ${viewMode === 'list' ? 'bg-white/[0.08] text-white' : 'text-white/35 hover:text-white'}`}><List size={15} /></button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 mb-8 overflow-x-auto pb-1 -mx-1 px-1">
        {[{ key: 'all', label: 'Всё', icon: <Sparkles size={13} /> }, { key: 'products', label: 'Товары', icon: <Grid3X3 size={13} /> }, { key: 'posts', label: 'Посты', icon: <FileText size={13} /> }, { key: 'ads', label: 'Реклама', icon: <Megaphone size={13} /> }].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key as TabType)} className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all whitespace-nowrap ${activeTab === tab.key ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/25' : 'text-white/50 hover:text-white hover:bg-white/[0.06]'}`}>{tab.icon}{tab.label}</button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className={viewMode === 'grid' ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5' : 'space-y-5'}>
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={idx} className="rounded-2xl overflow-hidden">
              <div className="skeleton h-52 rounded-2xl mb-3" />
              <div className="skeleton h-4 w-3/4 rounded-lg mb-2" />
              <div className="skeleton h-3 w-1/2 rounded-lg" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-24">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-white/[0.04] flex items-center justify-center"><Search size={24} className="text-white/25" /></div>
          <p className="text-white/50 text-sm">Ничего не найдено</p>
        </div>
      ) : (
        <>
          <motion.div
            className={viewMode === 'grid' ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5' : 'space-y-5'}
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }}
          >
            {items.map((item) => (
              <motion.div key={item.type + '-' + item.id} variants={{ hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0 } }}>
                {item.type === 'post' ? <PostCard post={item} onDelete={isAdmin ? delPost : undefined} /> : <ProductCard product={item} />}
              </motion.div>
            ))}
          </motion.div>
          
          {/* Infinite scroll loader */}
          <div ref={loaderRef} className="py-10 flex justify-center">
            {loadingMore && <Loader2 size={24} className="animate-spin text-indigo-400" />}
            {!showLoader && !loadingMore && items.length > 0 && (
              <p className="text-white/30 text-sm">Все загружены</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
