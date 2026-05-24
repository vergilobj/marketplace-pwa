import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { getFeed } from '../api/posts';
import { getProducts } from '../api/products';
import PostCard from '../components/PostCard';
import ProductCard from '../components/ProductCard';
import Skeleton from '../components/ui/Skeleton';
import ErrorState from '../components/ui/ErrorState';
import EmptyState from '../components/ui/EmptyState';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import { Search, FileText, Megaphone, SlidersHorizontal, Grid3X3, List, X } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import api from '../api/axios';
import toast from 'react-hot-toast';

type SortType = 'newest' | 'popular' | 'price_asc' | 'price_desc';
type ViewMode = 'grid' | 'list';

const sortOptions: { value: SortType; label: string }[] = [
  { value: 'newest', label: 'Новые' },
  { value: 'popular', label: 'Популярные' },
  { value: 'price_asc', label: 'Цена ↑' },
  { value: 'price_desc', label: 'Цена ↓' },
];

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.05 } },
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' } },
};

export default function FeedPage() {
  const navigate = useNavigate();
  const { isAdmin, isSeller } = useAuth();
  const [posts, setPosts] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'products' | 'posts'>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortType>('newest');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  const fetchData = async () => {
    try {
      const [postsRes, productsRes] = await Promise.all([getFeed(), getProducts()]);
      setPosts(postsRes);
      setProducts(productsRes);
    } catch (e) {
      setError('Ошибка загрузки данных');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('search');
    if (q) setSearch(q);
  }, []);

  const handleDeletePost = async (postId: string) => {
    if (!confirm('Удалить пост?')) return;
    try {
      await api.delete(`/posts/${postId}`);
      setPosts(prev => prev.filter(p => p.id !== postId));
      toast.success('Пост удалён');
    } catch (err) {
      toast.error('Не удалось удалить пост');
    }
  };

  const handleEditPost = (post: any) => {
    navigate(`/posts/${post.id}/edit`);
  };

  const filteredPosts = posts.filter(p =>
    p.title?.toLowerCase().includes(search.toLowerCase()) ||
    p.content?.toLowerCase().includes(search.toLowerCase())
  );
  const filteredProducts = products.filter(p =>
    p.title.toLowerCase().includes(search.toLowerCase())
  );

  const sortFn = (a: any, b: any) => {
    switch (sort) {
      case 'popular': return (b.likeCount || 0) - (a.likeCount || 0);
      case 'price_asc': return (a.price || 0) - (b.price || 0);
      case 'price_desc': return (b.price || 0) - (a.price || 0);
      default: return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }
  };

  const sortedPosts = [...filteredPosts].sort(sortFn);
  const sortedProducts = [...filteredProducts].sort(sortFn);

  const allItems = [
    ...sortedPosts.map(p => ({ ...p, type: 'post' })),
    ...sortedProducts.map(p => ({ ...p, type: 'product' })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Разделяем посты и товары для смешанной ленты
  const mixedPosts = allItems.filter(e => e.type === 'post');
  const mixedProducts = allItems.filter(e => e.type === 'product');

  const hasActiveSearch = search.trim().length > 0;

  const renderSkeletons = (count = 6) => (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="aspect-square rounded-3xl" />
      ))}
    </div>
  );

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <motion.h1 initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="text-4xl font-bold tracking-tight">
          Лента
        </motion.h1>
        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="flex gap-2">
          {isAdmin && (
            <Button variant="primary" size="sm" onClick={() => navigate('/posts/new')}>
              <FileText size={16} className="mr-1" /> Новый пост
            </Button>
          )}
          {isSeller && (
            <Button variant="secondary" size="sm" onClick={() => navigate('/posts/ad/new')}>
              <Megaphone size={16} className="mr-1" /> Реклама
            </Button>
          )}
        </motion.div>
      </div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Input
            placeholder="Поиск по ленте..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 h-12 rounded-2xl text-base"
          />
          <Search className="absolute left-4 top-4 text-gray-400" size={20} />
          {hasActiveSearch && (
            <button onClick={() => setSearch('')} className="absolute right-4 top-4 text-gray-400 hover:text-gray-600">
              <X size={18} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-gray-100 dark:bg-gray-800">
            <SlidersHorizontal size={16} className="text-gray-500" />
            <select value={sort} onChange={(e) => setSort(e.target.value as SortType)} className="bg-transparent text-sm font-medium outline-none">
              {sortOptions.map(opt => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
            </select>
          </div>
          <div className="flex rounded-2xl bg-gray-100 dark:bg-gray-800 p-1">
            <button onClick={() => setViewMode('grid')} className={`p-2 rounded-xl transition ${viewMode === 'grid' ? 'bg-white dark:bg-gray-700 shadow' : ''}`}><Grid3X3 size={16} className="text-gray-500" /></button>
            <button onClick={() => setViewMode('list')} className={`p-2 rounded-xl transition ${viewMode === 'list' ? 'bg-white dark:bg-gray-700 shadow' : ''}`}><List size={16} className="text-gray-500" /></button>
          </div>
        </div>
      </motion.div>

      {hasActiveSearch && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="text-sm text-gray-500 flex items-center justify-between">
          <span>Результаты поиска для «{search}»</span>
          <button onClick={() => setSearch('')} className="text-blue-600 hover:underline">Сбросить</button>
        </motion.div>
      )}

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="flex gap-2 p-1 rounded-2xl bg-gray-100 dark:bg-gray-800 w-fit">
        {[
          { key: 'all', label: 'Все' },
          { key: 'products', label: 'Товары' },
          { key: 'posts', label: 'Посты' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as typeof activeTab)}
            className={`px-5 py-2 rounded-xl text-sm font-medium transition-all ${
              activeTab === tab.key ? 'bg-white dark:bg-gray-700 shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </motion.div>

      {loading ? (
        renderSkeletons()
      ) : error ? (
        <ErrorState message={error} onRetry={fetchData} />
      ) : (
        <AnimatePresence mode="wait">
          {activeTab === 'posts' && (
            <motion.div key="posts" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {sortedPosts.length === 0 ? (
                <EmptyState message={hasActiveSearch ? `Посты по запросу «${search}» не найдены` : 'Постов пока нет'} />
              ) : (
                <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
                  {sortedPosts.map(post => (
                    <motion.div key={post.id} variants={item}>
                      <PostCard post={post} onDelete={handleDeletePost} onEdit={handleEditPost} />
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </motion.div>
          )}

          {activeTab === 'products' && (
            <motion.div key="products" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {sortedProducts.length === 0 ? (
                <EmptyState message={hasActiveSearch ? `Товары по запросу «${search}» не найдены` : 'Товаров пока нет'} />
              ) : (
                <motion.div
                  variants={container}
                  initial="hidden"
                  animate="show"
                  className={`grid gap-6 ${
                    viewMode === 'grid'
                      ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4'
                      : 'grid-cols-1 sm:grid-cols-2'
                  }`}
                >
                  {sortedProducts.map(product => (
                    <motion.div key={product.id} variants={item}>
                      <ProductCard product={product} />
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </motion.div>
          )}

          {activeTab === 'all' && (
            <motion.div key="all" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {allItems.length === 0 ? (
                <EmptyState message={hasActiveSearch ? `Ничего не найдено по запросу «${search}»` : 'Лента пуста'} />
              ) : (
                <div className="space-y-6">
                  {/* Посты (каждый на всю ширину) */}
                  {mixedPosts.map(post => (
                    <motion.div key={post.id} variants={item}>
                      <div className="flex items-center gap-2 mb-1 ml-1">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                          Пост
                        </span>
                      </div>
                      <PostCard post={post} onDelete={handleDeletePost} onEdit={handleEditPost} />
                    </motion.div>
                  ))}
                  {/* Товары (сеткой в ряд) */}
                  {mixedProducts.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-3 ml-1">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">
                          Товары
                        </span>
                      </div>
                      <motion.div
                        variants={container}
                        initial="hidden"
                        animate="show"
                        className={`grid gap-6 ${
                          viewMode === 'grid'
                            ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4'
                            : 'grid-cols-1 sm:grid-cols-2'
                        }`}
                      >
                        {mixedProducts.map(product => (
                          <motion.div key={product.id} variants={item}>
                            <ProductCard product={product} />
                          </motion.div>
                        ))}
                      </motion.div>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}