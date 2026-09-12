import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Heart, ShoppingCart, Trash2, Plus, Minus } from 'lucide-react';
import EmptyState from '../components/ui/EmptyState';
import { motion } from 'framer-motion';
import { useApp } from '../context/AppContext';
import { getProductById } from '../api/products';
import { formatPrice, plural } from "../utils/format";
import { resolveMedia } from '../utils/media';
import type { ApiProduct } from '../api/types';

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
        const rows = await mapWithConcurrency(ids, FAVORITES_FETCH_CONCURRENCY, (id) =>
          getProductById(id).catch(() => null),
        );
        if (!cancelled) setProducts(rows.filter((p): p is ApiProduct => p !== null));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [favoritesKey]);

  if (loading) return (
    <div className="flex justify-center py-32">
      <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#22c55e] to-[#34d399] animate-pulse" />
    </div>
  );

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div className="fixed inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 60% 40% at 50% -5%, rgba(34,197,94,0.10) 0%, transparent 60%)'
      }} />

      <div className="relative max-w-5xl mx-auto px-4 sm:px-6 pt-10 pb-20">
        <h1 className="text-2xl font-bold text-[var(--color-text)] mb-1">Избранное</h1>
        <p className="text-[var(--color-muted)] text-sm mb-6">{products.length} {plural(products.length, ['товар', 'товара', 'товаров'])}</p>

        {products.length === 0 ? (
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
                    {product.media?.[0] && <img src={resolveMedia(product.media[0])} alt={product.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />}
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
                      <button onClick={(e) => { e.stopPropagation(); toggleFavorite(product.id); }} className="px-3 py-2 rounded-xl bg-red-400/10 text-red-400 text-xs font-bold hover:bg-red-400/20 transition-all shrink-0"><Trash2 size={13} /></button>
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