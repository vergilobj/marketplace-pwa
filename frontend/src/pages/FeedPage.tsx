import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { getFeed } from '../api/posts';
import { getProducts } from '../api/products';
import { Search, X, Loader2, Heart, MessageCircle, ShoppingCart, Plus, Minus, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useApp } from '../context/AppContext';
import api from '../api/axios';
import toast from 'react-hot-toast';
import { formatPrice } from '../utils/format';
import { resolveMedia } from '../utils/media';
import BazarChat from '../components/bazar/BazarChat';
import DictateButton from '../components/DictateButton';
import { CreateMenu } from '../components/CreateMenu';
import { useDebounced } from '../hooks/useDebounced';
import { mergeUniqueById } from '../utils/mergeUnique';
import { readFeedCache, writeFeedCache } from './feedCache';
import type { ApiPost, ApiProduct } from '../api/types';

type SortType = 'newest' | 'popular' | 'price_asc' | 'price_desc';
type TabType = 'all' | 'posts' | 'products' | 'ads';

/**
 * ApiProduct.type — это ProductType из схемы ('PHYSICAL' | 'DIGITAL').
 * В ленте поле `type` переиспользовано под дискриминант, поэтому у товара
 * оно исключается через Omit и подставляется заново.
 */
type FeedProductItem = Omit<ApiProduct, 'type'> & { type: 'product' };
type FeedPostItem = ApiPost & { type: 'post' };

/**
 * Элемент смешанной ленты. Дискриминант `type` отличает товар от поста.
 * Через Extract<> каждый вариант достаётся по отдельности — так в JSX
 * сужение по `item.type === 'product'` реально работает, без кастов.
 */
type FeedItem = FeedProductItem | FeedPostItem;

const PAGE_SIZE = 20;

/** Ключ «какой набор фильтров соответствует текущим данным». */
const feedKey = (s: SortType, q: string) => `${s}\u0000${q}`;

export default function FeedPage() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const { isAdmin, isAuthenticated } = useAuth();
  const { cart, addToCart, updateQuantity } = useApp();
  // Кэш читается синхронно при инициализации состояния, а не в эффекте:
  // при возврате с карточки список уже в первом рендере, без «быстрой прогрузки».
  // При активном поиске кэш не подходит — там другой набор данных.
  const [cache] = useState(() => (sp.get('search') ? null : readFeedCache()));
  const [posts, setPosts] = useState<ApiPost[]>(() => cache?.posts ?? []);
  const [products, setProducts] = useState<ApiProduct[]>(() => cache?.products ?? []);
  const [totalPosts, setTotalPosts] = useState(() => cache?.totalPosts ?? 0);
  const [totalProducts, setTotalProducts] = useState(() => cache?.totalProducts ?? 0);
  const [postsPage, setPostsPage] = useState(() => cache?.postsPage ?? 1);
  const [productsPage, setProductsPage] = useState(() => cache?.productsPage ?? 1);
  const [hasMorePosts, setHasMorePosts] = useState(() => cache?.hasMorePosts ?? true);
  const [hasMoreProducts, setHasMoreProducts] = useState(() => cache?.hasMoreProducts ?? true);
  // Скелетон — ПРОИЗВОДНОЕ от того, совпадают ли фильтры с уже загруженными
  // данными (dataKey). Никакого setLoading в эффекте: смена сортировки/поиска
  // сама делает queryKey ≠ dataKey, а завершённая загрузка их выравнивает.
  const [dataKey, setDataKey] = useState<string | null>(() => (cache ? feedKey('newest', sp.get('search') || '') : null));
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [sort, setSort] = useState<SortType>('newest');
  // Чистый рендер: момент монтирования читаем один раз (см. adIsLive ниже).
  const [mountedAt] = useState(() => Date.now());
  const [search, setSearch] = useState(() => sp.get('search') || '');
  // R10: поиск уходит на сервер с дебаунсом, а не фильтрует 20 загруженных записей
  const debouncedSearch = useDebounced(search, 300);
  const loaderRef = useRef<HTMLDivElement>(null);
  const queryKey = feedKey(sort, debouncedSearch);
  const loading = dataKey !== queryKey;

  // Первая страница ленты. Запрос уходит из эффекта, а state-апдейты живут
  // в .then/.finally — синхронного setState в теле эффекта нет, каскадных
  // рендеров нет. Смена сортировки/поиска делает queryKey ≠ dataKey, поэтому
  // скелетон показывается сам, без отдельного setLoading.
  useEffect(() => {
    const key = feedKey(sort, debouncedSearch);
    let cancelled = false;
    Promise.all([
      getFeed({ page: 1, limit: PAGE_SIZE, sort, search: debouncedSearch.trim() || undefined }),
      getProducts({ page: 1, limit: PAGE_SIZE, sort: sort === 'price_asc' ? 'price_asc' : sort === 'price_desc' ? 'price_desc' : sort === 'popular' ? 'popular' : 'newest', search: debouncedSearch.trim() || undefined }),
    ])
      .then(([postRes, prodRes]) => {
        if (cancelled) return;
        setPosts(postRes.items || []);
        setProducts(prodRes.items || []);
        setTotalPosts(postRes.total || postRes.items?.length || 0);
        setTotalProducts(prodRes.total || prodRes.items?.length || 0);
        setHasMorePosts(postRes.page < postRes.pages);
        setHasMoreProducts(prodRes.page < prodRes.pages);
        setPostsPage(2);
        setProductsPage(2);
      })
      .catch((e) => {
        console.error('Failed to load feed', e);
      })
      .finally(() => {
        // Набор помечается обработанным даже при ошибке — иначе скелетон зависнет.
        if (!cancelled) setDataKey(key);
      });
    return () => {
      cancelled = true;
    };
  }, [sort, debouncedSearch]);

  // Восстановление скролла после рендера
  useEffect(() => {
    const savedScroll = sessionStorage.getItem('feed_scroll');
    if (savedScroll && !loading && posts.length > 0) {
      requestAnimationFrame(() => {
        window.scrollTo(0, parseInt(savedScroll, 10));
        sessionStorage.removeItem('feed_scroll');
      });
    }
  }, [loading, posts.length]);

  const saveScrollAndNavigate = (to: string) => {
    sessionStorage.setItem('feed_scroll', String(window.scrollY));
    // Кэшируем текущие данные, чтобы при возврате не было «быстрой прогрузки»
    writeFeedCache({
      posts, products, totalPosts, totalProducts,
      postsPage, productsPage, hasMorePosts, hasMoreProducts,
    });
    navigate(to);
  };

  const loadMore = useCallback(async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const isPostTab = activeTab === 'posts' || activeTab === 'ads';
      const isProductTab = activeTab === 'products';
      if ((isPostTab || activeTab === 'all') && hasMorePosts) {
        const res = await getFeed({ page: postsPage, limit: PAGE_SIZE, sort, search: debouncedSearch.trim() || undefined });
        setPosts(prev => mergeUniqueById(prev, res.items || []));
        setHasMorePosts(res.page < res.pages);
        setPostsPage(p => p + 1);
      }
      if ((isProductTab || activeTab === 'all') && hasMoreProducts) {
        const res = await getProducts({ page: productsPage, limit: PAGE_SIZE, sort: sort === 'price_asc' ? 'price_asc' : sort === 'price_desc' ? 'price_desc' : sort === 'popular' ? 'popular' : 'newest', search: debouncedSearch.trim() || undefined });
        setProducts(prev => mergeUniqueById(prev, res.items || []));
        setHasMoreProducts(res.page < res.pages);
        setProductsPage(p => p + 1);
      }
    } catch (e) {
      console.error('Failed to load more', e);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, activeTab, sort, postsPage, productsPage, hasMorePosts, hasMoreProducts, debouncedSearch]);

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

  /**
   * V4 (VISUAL-PROD фикс 4): удаление поста админом.
   *
   * В публичной ленте на каждой карточке висела голая красная надпись
   * «удалить» 10px (`text-red-400`, 48×44, без фона) — 20 штук подряд,
   * вперемешку с зелёными кнопками соседних карточек. Владелец описал это
   * как «пздц». Теперь кнопка выглядит как обычный тач-таргет 44×44
   * (иконка + подпись на sm+), в нейтральном цвете, красная только при
   * наведении — модерация не кричит из публичной ленты.
   *
   * confirm() здесь уже был и сохранён: без него клик сносил боевой пост
   * мгновенно (в отчёте аудита `hasConfirm: false` — это про DOM-диалог,
   * который confirm() не создаёт).
   */
  const delPost = async (id: string) => {
    if (!confirm('Удалить?')) return;
    try { await api.delete('/posts/' + id); setPosts(p => p.filter(x => x.id !== id)); toast.success('Удалён'); } catch { toast.error('Ошибка'); }
  };

  const togglePostLike = async (post: ApiPost, e: React.MouseEvent) => {
    e.stopPropagation();
    const liked = post.likedByMe || false;
    const likes = post.likeCount || 0;
    setPosts(prev => prev.map(p => p.id === post.id ? { ...p, likedByMe: !liked, likeCount: likes + (liked ? -1 : 1) } : p));
    try {
      if (liked) { await api.delete(`/social/${post.id}/like`); }
      else { await api.post(`/social/${post.id}/like`); }
    } catch { toast.error('Не удалось'); }
  };

  // Сервер уже отфильтровал выдачу по поисковому запросу (R10)
  const fp = posts;
  const fpr = products;
  /**
   * A5.7: реклама видна в ленте только оплаченной.
   *
   * Бэкенд отдаёт рекламу лишь при `isPinned && adExpireDate >= now` и
   * подтверждённом заказе (PAID + escrow HELD), но на клиенте повторяем
   * условие по сроку — страховка от закешированной выдачи и от бэкенда,
   * который ещё не перезапущен со свежей сборкой. Неоплаченная реклама
   * (нет adExpireDate / срок вышел) в таб «Реклама» не попадает.
   *
   * Момент времени берём из ленивого инициализатора useState, а не из
   * Date.now() в теле рендера: рендер обязан быть чистым (react-hooks/purity),
   * иначе результат фильтра меняется от прогона к прогону. Свежесть даёт
   * сервер — он пересчитывает видимость на каждом запросе ленты.
   */
  const adIsLive = (p: ApiPost) =>
    p.isAd === true &&
    !!p.adExpireDate &&
    new Date(p.adExpireDate).getTime() > mountedAt;
  const ads = fp.filter(adIsLive);
  const regular = fp.filter(p => !p.isAd);

  // Смешанная лента с живым ритмом
  const items = (() => {
    const postsArr: FeedPostItem[] = regular.map(p => ({ ...p, type: 'post' as const }));
    const prodArr: FeedProductItem[] = fpr.map(p => ({ ...p, type: 'product' as const }));
    if (activeTab === 'posts') return postsArr;
    if (activeTab === 'products') return prodArr;
    const adsArr: FeedPostItem[] = ads.map(p => ({ ...p, type: 'post' as const }));
    if (activeTab === 'ads') return adsArr;
    const mixed: FeedItem[] = [];
    let pi = 0, ti = 0;
    const seq = [2, 1, 3, 2, 1, 4, 2, 3, 1, 2];
    let i = 0;
    while (pi < postsArr.length || ti < prodArr.length) {
      const batch = seq[i % seq.length];
      if (i % 3 === 2) {
        for (let k = 0; k < batch && ti < prodArr.length; k++) mixed.push(prodArr[ti++]);
        if (pi < postsArr.length) mixed.push(postsArr[pi++]);
      } else {
        for (let k = 0; k < batch && pi < postsArr.length; k++) mixed.push(postsArr[pi++]);
        if (ti < prodArr.length) mixed.push(prodArr[ti++]);
      }
      i++;
    }
    return [...adsArr, ...mixed];
  })();

  const showLoader = activeTab === 'all' ? (hasMorePosts || hasMoreProducts) : activeTab === 'products' ? hasMoreProducts : hasMorePosts;

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      {/* Фоновое свечение — зелёное, мягкое */}
      <div className="fixed inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 60% 40% at 50% -5%, rgba(34,197,94,0.14) 0%, transparent 60%), radial-gradient(ellipse 50% 35% at 85% 110%, rgba(13,148,136,0.10) 0%, transparent 60%)'
      }} />

      <div className="relative max-w-5xl mx-auto px-4 sm:px-6 pt-10 pb-20">

        {/* МАНИФЕСТ — дерзкий, с визуалом */}
        <div className="mb-10">
          <div className="flex flex-col lg:flex-row lg:items-center gap-8">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-5">
                <span className="w-2 h-2 rounded-full bg-[#22c55e] animate-pulse" />
                <span className="text-[11px] uppercase tracking-[0.3em] text-[var(--color-muted)]">только по своим</span>
              </div>
              <h1 className="font-extrabold tracking-tight text-[var(--color-text)] leading-[1.05] whitespace-nowrap text-[clamp(3.5rem,11vw,6.5rem)] sm:leading-[0.9] sm:whitespace-normal sm:text-[clamp(3rem,9vw,6rem)]">
                Твой<span className="sm:hidden"> </span><br className="hidden sm:block" />
                <span style={{ background: 'linear-gradient(90deg, #22c55e, #34d399)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>рынок.</span>
              </h1>
              <p className="mt-5 text-[var(--color-muted)] text-base max-w-md">
                Закрытая площадка. Товары, канал, чат — для тех, кто внутри.
              </p>

              {/* Реальные счётчики — из данных */}
              <div className="mt-8 flex gap-8">
                <div>
                  <div className="text-3xl font-extrabold text-[var(--color-text)]">{totalProducts}</div>
                  <div className="text-[11px] uppercase tracking-wider text-[var(--color-muted)] mt-1">товаров</div>
                </div>
                <div>
                  <div className="text-3xl font-extrabold text-[var(--color-text)]">{totalPosts}</div>
                  <div className="text-[11px] uppercase tracking-wider text-[var(--color-muted)] mt-1">постов</div>
                </div>
                <div>
                  <div className="text-3xl font-extrabold text-[#22c55e]">закрыто</div>
                  <div className="text-[11px] uppercase tracking-wider text-[var(--color-muted)] mt-1">по инвайтам</div>
                </div>
              </div>

              <div className="mt-7 flex gap-2 flex-wrap">
                <CreateMenu variant="button" />
                {!isAuthenticated && <button onClick={() => navigate('/register')} className="btn-capsule btn-primary">Вступить</button>}
              </div>
            </div>

            <div className="lg:w-96 xl:w-[420px] shrink-0 relative">
              <img src="/manifest-cart.webp" alt="Безопасный чеккаут" className="w-full h-auto" loading="eager" />
            </div>
          </div>
        </div>

        {/* БАЗАР — личный помощник */}
        <div className="mb-10">
          <div className="mb-4">
            <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Спросить Базара</h2>
          </div>
          <div
            className="rounded-3xl mb-1"
            style={{ border: '1px solid rgba(34,197,94,0.12)' }}
          >
            <div className="rounded-3xl bg-[#0d1210] p-4 sm:p-5">
              <BazarChat compact />
            </div>
          </div>
        </div>

        {/* ПОИСК — минималистичный */}
        <div className="mb-8">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Искать среди своих…" className="w-full pl-10 pr-20 py-3 rounded-xl bg-[var(--color-surface)] text-[var(--color-text)] text-sm outline-none border border-[var(--color-border)] focus:border-[#22c55e] transition-colors" />
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
              {/* Крестик первым в DOM: микрофон всегда прижат к правому краю
                  и не сдвигается, когда появляется/исчезает очистка. */}
              {search && <button onClick={() => setSearch('')} aria-label="Очистить поиск" className="w-11 h-11 flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-text)]"><X size={16} /></button>}
              <DictateButton size={15} className="w-11 h-11" onResult={(text) => setSearch(text)} />
            </div>
          </div>
        </div>

        {/* ТАБЫ + СОРТИРОВКА — G1: на mobile переносим строки, чтобы блок
            сортировки не уезжал за вьюпорт на 194px. */}
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar min-w-0 max-w-full">
            {[{ key: 'all', label: 'Всё' }, { key: 'posts', label: 'Канал' }, { key: 'products', label: 'Товары' }, { key: 'ads', label: 'Реклама' }].map(tab => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key as TabType)} className={`px-4 min-h-[44px] inline-flex items-center rounded-lg text-sm font-bold whitespace-nowrap transition-colors ${activeTab === tab.key ? 'bg-[#22c55e] text-white' : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'}`}>{tab.label}</button>
            ))}
          </div>
          <div className="flex gap-1.5 shrink-0 sm:ml-auto max-w-full overflow-x-auto pb-1 no-scrollbar">
            {(['newest','popular','price_asc','price_desc'] as SortType[]).map(s => {
              const labels: Record<SortType,string> = { newest:'Свежее', popular:'Хайп', price_asc:'Дешевле', price_desc:'Дороже' };
              return <button key={s} onClick={() => setSort(s)} className={`px-3 min-h-[44px] inline-flex items-center rounded-lg text-[11px] font-bold whitespace-nowrap transition-colors ${sort === s ? 'text-[#22c55e] border border-[#22c55e]' : 'text-[var(--color-muted)] border border-[var(--color-border)] hover:text-[var(--color-text)]'}`}>{labels[s]}</button>;
            })}
          </div>
        </div>

        {/* ЛЕНТА */}
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, idx) => <div key={idx} className="h-16 rounded-lg bg-[var(--color-surface)] animate-pulse" />)}
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-24">
            <div className="text-[var(--color-faint)] text-sm">
              {search ? 'По запросу ничего не нашлось.' : 'Пока тихо. Здесь начнётся твой рынок.'}
            </div>
          </div>
        ) : (
          <motion.div
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }}
            className="divide-y divide-[var(--color-border)]"
          >
            {items.map((item) => {
              if (item.type === 'product') {
                const inCart = !!cart.find((i) => i.productId === item.id);
                const qty = cart.find((i) => i.productId === item.id)?.quantity || 1;

                // Рекламный товар — вертикальная карточка: картинка сверху, инфо + кнопка снизу
                if (item.isAd) {
                  return (
                    <motion.div
                      key={'p-' + item.id}
                      variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
                      transition={{ duration: 0.2 }}
                      onClick={() => saveScrollAndNavigate(`/products/${item.id}`)}
                      className="py-4 my-3 cursor-pointer group"
                    >
                      <div className="rounded-2xl overflow-hidden border border-[var(--color-border)] transition-all duration-200 group-hover:border-[#22c55e]/40 group-hover:shadow-[0_0_0_1px_rgba(34,197,94,0.08),0_8px_32px_-12px_rgba(34,197,94,0.35)]">
                        {/* Картинка сверху на всю ширину */}
                        <div className="relative aspect-[16/10] w-full bg-[var(--color-surface)]">
                          {item.media?.[0]
                            ? <img src={resolveMedia(item.media[0])} alt={item.title} className="w-full h-full object-cover" loading="lazy" decoding="async" width={640} height={400} />
                            : <div className="w-full h-full flex items-center justify-center"><ShoppingBagIcon /></div>}
                          <span className="absolute top-2.5 left-2.5 bg-[#22c55e] text-[#0d1512] text-[10px] font-extrabold uppercase px-2 py-1 rounded-full shadow-[0_0_12px_rgba(34,197,94,0.4)]">Реклама</span>
                        </div>

                        {/* Инфо + кнопка */}
                        <div className="p-3.5">
                          <div className="text-[15px] font-bold text-[var(--color-text)] leading-snug group-hover:text-[#22c55e] transition-colors">{item.title}</div>
                          <div className="text-[11px] text-[var(--color-muted)] mt-0.5">{item.seller?.name}</div>
                          {item.description && (
                            <div className="text-[12px] text-[var(--color-muted)] line-clamp-2 mt-1.5">{item.description}</div>
                          )}

                          <div className="mt-3 flex items-center justify-between gap-3">
                            <div className="text-lg font-extrabold text-[#22c55e] whitespace-nowrap">{formatPrice(item.price)}</div>
                            {!inCart ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); addToCart(item); }}
                                className="shrink-0 min-h-[44px] px-5 rounded-xl bg-[#22c55e] text-white text-sm font-bold flex items-center gap-1.5 transition-colors hover:bg-[#16a34a]"
                              >
                                <ShoppingCart size={16} /> В корзину
                              </button>
                            ) : (
                              <div className="shrink-0 flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                                <button onClick={(e) => { e.stopPropagation(); updateQuantity(item.id, -1); }} aria-label="Меньше" className="w-11 h-11 rounded-xl border border-[var(--color-border)] hover:bg-[var(--bg-3)] text-[var(--color-text)] flex items-center justify-center"><Minus size={15} /></button>
                                <span className="text-base font-bold text-[var(--color-text)] min-w-[22px] text-center">{qty}</span>
                                <button onClick={(e) => { e.stopPropagation(); addToCart(item); }} aria-label="Больше" className="w-11 h-11 rounded-xl border border-[var(--color-border)] hover:bg-[var(--bg-3)] text-[var(--color-text)] flex items-center justify-center"><Plus size={15} /></button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  );
                }

                // Обычный товар — компактная строка
                return (
                  <motion.div key={'p-' + item.id} variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }} transition={{ duration: 0.2 }} onClick={() => saveScrollAndNavigate(`/products/${item.id}`)} className="py-3.5 flex items-center gap-3.5 cursor-pointer group">
                    <div className="w-14 h-14 rounded-xl bg-[var(--color-surface)] shrink-0 overflow-hidden flex items-center justify-center">
                      {item.media?.[0] ? <img src={resolveMedia(item.media[0])} alt={item.title} className="w-full h-full object-cover" loading="lazy" decoding="async" width={56} height={56} /> : <ShoppingBagIcon />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-[var(--color-text)] truncate group-hover:text-[#22c55e] transition-colors">{item.title}</div>
                      <div className="text-[11px] text-[var(--color-muted)] truncate">{item.seller?.name}</div>
                    </div>
                    <div className="text-sm font-bold text-[#22c55e] whitespace-nowrap">{formatPrice(item.price)}</div>
                    {!inCart ? (
                      <button onClick={(e) => { e.stopPropagation(); addToCart(item); }} title="В корзину" aria-label="В корзину" className="shrink-0 w-11 h-11 rounded-lg bg-[#22c55e] text-white transition-colors flex items-center justify-center"><ShoppingCart size={17} /></button>
                    ) : (
                      <div className="shrink-0 flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <button onClick={(e) => { e.stopPropagation(); updateQuantity(item.id, -1); }} aria-label="Меньше" className="w-11 h-11 rounded-lg border border-[var(--color-border)] hover:bg-[var(--bg-3)] text-[var(--color-text)] flex items-center justify-center"><Minus size={15} /></button>
                        <span className="text-sm font-bold text-[var(--color-text)] min-w-[18px] text-center">{qty}</span>
                        <button onClick={(e) => { e.stopPropagation(); addToCart(item); }} aria-label="Больше" className="w-11 h-11 rounded-lg border border-[var(--color-border)] hover:bg-[var(--bg-3)] text-[var(--color-text)] flex items-center justify-center"><Plus size={15} /></button>
                      </div>
                    )}
                  </motion.div>
                );
              }
              return (
                <motion.div key={'po-' + item.id} variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }} transition={{ duration: 0.2 }} onClick={() => saveScrollAndNavigate(`/posts/${item.id}`)} className={`py-5 cursor-pointer group ${item.isAd ? 'my-3 px-3.5 rounded-2xl border border-[var(--color-border)] transition-all duration-200 hover:border-[#22c55e]/40 hover:bg-gradient-to-br hover:from-[#22c55e]/12 hover:via-transparent hover:to-[#14b8a6]/10 hover:shadow-[0_0_0_1px_rgba(34,197,94,0.08),0_8px_32px_-12px_rgba(34,197,94,0.35)]' : ''}`}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[9px] font-bold text-[#0d1512] ${item.isAd ? 'bg-gradient-to-br from-[#22c55e] to-[#14b8a6]' : 'bg-[#22c55e] text-white'}`}>{(item.author?.name || item.adOwner?.name || 'A')[0].toUpperCase()}</div>
                    <span className="text-xs text-[var(--color-muted)]">{item.author?.name || item.adOwner?.name || 'Аноним'}</span>
                    {item.isAd && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#22c55e] text-[#0d1512] text-[9px] font-extrabold uppercase tracking-wide shadow-[0_0_12px_rgba(34,197,94,0.4)]">Реклама</span>}
                  </div>
                  <div className="text-[15px] font-bold text-[var(--color-text)] group-hover:text-[#22c55e] transition-colors">{item.title}</div>
                  {item.content && <div className="text-[12px] text-[var(--color-muted)] line-clamp-2 mt-1">{item.content}</div>}

                  {/* Фото поста — карусель на всю ширину */}
                  {Array.isArray(item.media) && item.media.length > 0 && (
                    <PostMedia media={item.media} title={item.title} />
                  )}

                  <div className="flex items-center gap-2 mt-2.5">
                    <button onClick={(e) => togglePostLike(item, e)} className={`flex items-center justify-center gap-1.5 px-2.5 min-h-[44px] min-w-[44px] rounded-lg text-xs font-medium transition-colors ${item.likedByMe ? 'text-[#22c55e] bg-[rgba(34,197,94,0.1)]' : 'text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--bg-3)]'}`}>
                      <Heart size={14} fill={item.likedByMe ? 'currentColor' : 'none'} />
                      {(item.likeCount ?? 0) > 0 && item.likeCount}
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); saveScrollAndNavigate(`/posts/${item.id}`); }} className="flex items-center justify-center gap-1.5 px-2.5 min-h-[44px] min-w-[44px] rounded-lg text-xs text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--bg-3)] transition-colors">
                      <MessageCircle size={14} />
                      {(item.commentCount ?? 0) > 0 && item.commentCount}
                    </button>
                    {isAdmin && (
                      <button
                        onClick={(e) => { e.stopPropagation(); delPost(item.id); }}
                        aria-label="Удалить пост"
                        title="Удалить пост"
                        className="ml-auto flex items-center justify-center gap-1.5 px-2.5 min-h-[44px] min-w-[44px] rounded-lg text-xs text-[var(--color-muted)] hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/30 transition-colors"
                      >
                        <Trash2 size={14} />
                        <span className="hidden sm:inline">Удалить</span>
                      </button>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        )}

        <div ref={loaderRef} className="py-8 flex justify-center">
          {loadingMore && <Loader2 size={20} className="animate-spin text-[#22c55e]" />}
          {!showLoader && !loadingMore && items.length > 0 && <span className="text-[var(--color-faint)] text-xs">Всё показали</span>}
        </div>
      </div>
    </div>
  );
}

function ShoppingBagIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--color-faint)]"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>;
}

// Карусель фото поста: листание стрелками + индикаторы, картинка на всю ширину
function PostMedia({ media, title }: { media: string[]; title: string }) {
  const [idx, setIdx] = useState(0);
  if (!media || media.length === 0) return null;
  const count = media.length;
  const go = (n: number) => setIdx((idx + n + count) % count);
  return (
    <div className="mt-2.5 relative -mx-4 sm:mx-0">
      <div className="relative w-full overflow-hidden rounded-none sm:rounded-xl">
        <img
          src={resolveMedia(media[idx])}
          alt={`${title} ${idx + 1}`}
          className="w-full h-auto max-h-[480px] object-cover"
          loading="lazy"
          decoding="async"
          onClick={(e) => e.stopPropagation()}
        />
        {/*
          FIX-REST фикс 3 (карусель): рендерился ТОЛЬКО текущий слайд, поэтому
          остальные фотографии поста не запрашивались вообще. Листание давало
          пустой прямоугольник на время загрузки — тот же «серый квадрат»,
          только по клику. Предзагружаем соседние слайды заранее: они попадают
          в кэш браузера, листание становится мгновенным.
        */}
        <div className="hidden" aria-hidden="true">
          {media.map((m, i) => (
            i === idx ? null : <img key={i} src={resolveMedia(m)} alt="" loading="lazy" decoding="async" />
          ))}
        </div>
        {count > 1 && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); go(-1); }}
              aria-label="Предыдущее фото"
              className="tap-chip absolute left-0.5 top-1/2 -translate-y-1/2 w-11 h-11"
            >
              <span className="w-8 h-8 rounded-full bg-black/55 backdrop-blur text-white flex items-center justify-center hover:bg-black/75 transition-colors">
                <ChevronLeft size={18} />
              </span>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); go(1); }}
              aria-label="Следующее фото"
              className="tap-chip absolute right-0.5 top-1/2 -translate-y-1/2 w-11 h-11"
            >
              <span className="w-8 h-8 rounded-full bg-black/55 backdrop-blur text-white flex items-center justify-center hover:bg-black/75 transition-colors">
                <ChevronRight size={18} />
              </span>
            </button>
            <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 flex gap-1.5">
              {media.map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 rounded-full transition-all ${i === idx ? 'w-4 bg-white' : 'w-1.5 bg-white/50'}`}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}