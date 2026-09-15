import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Heart, HeartOff, ShoppingCart, Plus, Minus } from 'lucide-react';
import EmptyState from '../components/ui/EmptyState';
import { motion } from 'framer-motion';
import { useApp } from '../context/AppContext';
import { getProductById } from '../api/products';
import { formatPrice, plural } from "../utils/format";
import type { ApiProduct } from '../api/types';
import { ProductGridSkeleton, SkeletonLine } from '../components/ui/Skeleton';
import ErrorState from '../components/ui/ErrorState';
import MediaImage from '../components/ui/MediaImage';
import { useListError } from '../hooks/useListError';
import { errorStatus } from '../utils/error';

/**
 * L2: избранное больше НЕ тянет каталог.
 *
 * Было: `getProducts({ limit: 2000 })` — две тысячи товаров одним запросом + фильтр
 * на клиенте. Это ровно «тысячи айтемов одним запросом», плюс после L1 такой
 * limit всё равно клампится до 100, и фильтр вернул бы только те избранные,
 * которые случайно попали в первые 100 каталога (тихая потеря данных).
 *
 * Стало (вариант «б» из ТЗ): id избранного известны локально
 * (`localStorage.favorites`), поэтому тянем РОВНО их через `GET /products/:id`,
 * с ограничением параллелизма. `GET /products?ids=...` на бэке нет (L1 его не
 * делал) — проверено по `products.controller.ts`, поэтому вариант «а» отпадает.
 * Вариант «в» (infinite scroll по каталогу) оставлял бы клиентский фильтр и
 * тянул бы лишние товары — отклонён.
 *
 * Объём запросов = размер избранного (обычно <50), а не размер базы.
 * Если товар снят/удалён — `getProductById` бросает, элемент молча пропускается
 * (и удаляется из списка), остальные избранные при этом не теряются.
 */
const FAVORITES_FETCH_CONCURRENCY = 6;

/** Пул воркеров: не больше N запросов в полёте, порядок id сохраняется. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

export default function FavoritesPage() {
  const navigate = useNavigate();
  const { favorites, cart, toggleFavorite, addToCart, updateQuantity } = useApp();
  const [products, setProducts] = useState<ApiProduct[]>([]);
  const [loading, setLoading] = useState(true);
  // HIGH-1: сбой загрузки → ErrorState с «Повторить», а не «Нет избранного».
  const { error, setError, retryKey, errorProps } = useListError();

  // Ключ набора — сами id: список товаров должен перезагружаться и при
  // добавлении, и при удалении из избранного. Ref-effect на `favorites`
  // (массив из контекста пересоздаётся на каждый рендер) дал бы цикл запросов,
  // поэтому зависимость — стабильная строка.
  const favoritesKey = favorites.join(',');

  useEffect(() => {
    const ids = favoritesKey ? favoritesKey.split(',') : [];
    let cancelled = false;

    // Всё внутри async IIFE: синхронный setState в теле эффекта даёт каскадный
    // рендер (react-hooks/set-state-in-effect), а ожидание промиса делает
    // апдейты асинхронными.
    (async () => {
      if (cancelled) return;
      if (ids.length === 0) {
        setProducts([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        /**
         * HIGH-1: раньше ЛЮБАЯ ошибка товара молча превращалась в null и
         * элемент просто исчезал из списка. При сетевом сбое так исчезали
         * ВСЕ избранные — юзер видел «Нет избранного» вместо «не загрузилось».
         *
         * Различаем два случая: товар реально снят (4xx — 404/403) и сбой
         * связи/сервера (нет ответа или 5xx). Первый — пропускаем молча,
         * второй — считаем, чтобы показать ErrorState.
         */
        let networkFailures = 0;
        const rows = await mapWithConcurrency(ids, FAVORITES_FETCH_CONCURRENCY, (id) =>
          getProductById(id).catch((e) => {
            const status = errorStatus(e);
            if (status === null || status === 0 || status >= 500 || status === 429) {
              networkFailures += 1;
            }
            return null;
          }),
        );
        if (cancelled) return;
        const loaded = rows.filter((p): p is ApiProduct => p !== null);
        setProducts(loaded);
        if (networkFailures > 0 && loaded.length === 0) {
          setError('Не удалось загрузить избранное');
        } else {
          setError('');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [favoritesKey, retryKey, setError]);

  /**
   * B2 (WAVE 2, п.8): скелетон совпадает с реальной сеткой избранного.
   *
   * Было `PageSkeleton rows={0} wide` — одна широкая карточка на всю страницу,
   * а затем та же страница рисовала сетку 2/3 колонки. При подмене контент
   * прыгал. Теперь — тот же `ProductGridSkeleton`, что и в каталоге, но с
   * сеткой и форматом фото избранного (квадрат-фото, 2/3 колонки) и с
   * заголовком/счётчиком сверху, как у загруженной страницы.
   */
  if (loading) {
    return (
      <div className="relative min-h-screen overflow-x-hidden">
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 pt-10 pb-20">
          <SkeletonLine className="h-7 w-40 mb-3" />
          <SkeletonLine className="h-3.5 w-24 mb-6" />
          <ProductGridSkeleton
            count={6}
            gridClassName="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4"
            imageClassName="w-full aspect-square rounded-none"
            cardClassName="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)]"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div className="fixed inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 60% 40% at 50% -5%, rgba(34,197,94,0.10) 0%, transparent 60%)'
      }} />

      <div className="relative max-w-5xl mx-auto px-4 sm:px-6 pt-10 pb-20">
        <h1 className="text-2xl font-bold text-[var(--color-text)] mb-1">Избранное</h1>
        <p className="text-[var(--color-muted)] text-sm mb-6">{products.length} {plural(products.length, ['товар', 'товара', 'товаров'])}</p>

        {products.length === 0 && error ? (
          <ErrorState {...errorProps} />
        ) : products.length === 0 ? (
          <EmptyState
            icon={<Heart size={32} />}
            message="Нет избранного — время полазить по базару"
            headingLevel="h2"
            action={{ label: 'В каталог', onClick: () => navigate('/products') }}
          />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
            {products.map((product, i) => {
              const price = formatPrice(product.price);
              const ci = cart.find((item) => item.productId === product.id);
              const inC = !!ci;
              const q = ci?.quantity || 1;
              return (
                <motion.div
                  key={product.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="group rounded-2xl overflow-hidden cursor-pointer flex flex-col h-full bg-[var(--color-surface)] border border-[var(--color-border)] hover:border-[#22c55e]/40 transition-colors"
                  onClick={() => navigate(`/products/${product.id}`)}
                >
                  <div className="aspect-square bg-[var(--bg-3)] relative shrink-0">
                    {/* B2 п.4: битое/404-медиа → та же заглушка, что и при отсутствии фото. */}
                    <MediaImage
                      src={product.media?.[0]}
                      alt={product.title}
                      width={640}
                      height={640}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      loading="lazy"
                      decoding="async"
                      fallback={
                        <div className="w-full h-full flex items-center justify-center">
                          <ShoppingCart size={24} className="text-[var(--color-faint)]" />
                        </div>
                      }
                    />
                    <span className="absolute bottom-3 left-3 px-3 py-1.5 rounded-xl bg-black/70 backdrop-blur-xl text-sm font-bold text-white">{price}</span>
                  </div>
                  <div className="p-3.5 flex flex-col flex-1">
                    <h3 className="text-sm font-bold text-[var(--color-text)] line-clamp-2 mb-3 group-hover:text-[#22c55e] transition-colors flex-1">{product.title}</h3>

                    <div className="mt-auto flex gap-2" onClick={e => e.stopPropagation()}>
                      {inC ? (
                        <div className="flex-1 flex items-center justify-between gap-1 bg-[#22c55e]/10 border border-[#22c55e]/20 rounded-xl px-2 py-2">
                          <button onClick={(e) => { e.stopPropagation(); updateQuantity(product.id, -1); }} className="p-1 rounded-lg hover:bg-white/[0.08] text-[#22c55e] transition-all"><Minus size={13} /></button>
                          <span className="text-xs font-bold text-[var(--color-text)] min-w-[20px] text-center">{q}</span>
                          <button onClick={(e) => { e.stopPropagation(); addToCart(product); }} className="p-1 rounded-lg hover:bg-white/[0.08] text-[#22c55e] transition-all"><Plus size={13} /></button>
                        </div>
                      ) : (
                        <button onClick={(e) => { e.stopPropagation(); addToCart(product); }} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-[#22c55e] text-[#0d1512] text-xs font-bold hover:bg-[#16a34a] transition-all"><ShoppingCart size={13} /> В корзину</button>
                      )}
                      {/*
                        * B2 (WAVE 2, п.5): была красная кнопка с иконкой Trash2 —
                        * читалась как «удалить товар», хотя убирает только из
                        * избранного. Плюс без подписи для скринридера и без
                        * подтверждения: промах по тач-таргету молча выкидывал
                        * товар из списка.
                        *
                        * Стало: HeartOff (та же семья, что Heart в ProductCard),
                        * нейтральный цвет вместо «тревожного» красного,
                        * aria-label и подтверждение.
                        */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!confirm('Убрать из избранного?')) return;
                          toggleFavorite(product.id);
                        }}
                        aria-label="Убрать из избранного"
                        title="Убрать из избранного"
                        className="px-3 py-2 rounded-xl bg-[rgba(255,255,255,0.05)] border border-[var(--color-border)] text-[var(--color-muted)] text-xs font-bold hover:text-[var(--color-text)] hover:border-[#22c55e]/40 transition-all shrink-0"
                      >
                        <HeartOff size={13} />
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}