import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import api from '../api/axios';
import { useNavigate } from 'react-router-dom';
import { Package, Plus, EyeOff, Eye, Megaphone, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { formatPrice } from '../utils/format';
import { resolveMedia } from '../utils/media';

/**
 * A5: «Мои товары».
 *
 * Правки этого билдера:
 *  - п.8: свой профиль открывается по клику на шапку (та же публичная
 *    страница, что и для чужих профилей — телефон/баланс она не показывает);
 *  - п.7: строка рекламы показывает, оплачена она или ждёт оплаты. Реклама
 *    становится видимой в ленте только после оплаты, и владелец должен это
 *    видеть, а не гадать, почему её нет.
 *  - п.5: в интерфейсе создания больше нет поля видео-ссылки (это A2), здесь
 *    только карточки.
 */

type MyProduct = {
  id: string;
  title: string;
  price: number;
  media?: string[] | null;
  isActive?: boolean;
  isAd?: boolean;
  videoUrl?: string | null;
};

export default function MyProductsPage() {
  const navigate = useNavigate();
  const [products, setProducts] = useState<MyProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<MyProduct[]>('/products/my')
      .then((r) => setProducts(r.data || []))
      .catch(() => setProducts([]))
      .finally(() => setLoading(false));

    // Свой id — из профиля: клик по шапке ведёт на публичную страницу.
    api
      .get<{ id: string }>('/users/me')
      .then((r) => setUserId(r.data?.id ?? null))
      .catch(() => setUserId(null));
  }, []);

  const toggle = async (id: string) => {
    if (busyIds.includes(id)) return;
    setBusyIds((prev) => [...prev, id]);
    try {
      await api.patch(`/products/${id}/toggle-active`);
      setProducts((p) => p.map((x) => (x.id === id ? { ...x, isActive: !x.isActive } : x)));
      toast.success('Обновлено');
    } catch {
      toast.error('Не удалось обновить товар');
    } finally {
      setBusyIds((prev) => prev.filter((x) => x !== id));
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-32">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#22c55e] to-[#34d399] animate-pulse" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-wrap items-center justify-between gap-3 mb-8"
      >
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)] mb-1">Мои товары</h1>
          {userId ? (
            <button
              type="button"
              onClick={() => navigate(`/users/${userId}`)}
              className="text-sm text-[var(--color-muted)] hover:text-[#22c55e] transition-colors underline underline-offset-2"
            >
              Как видят покупатели →
            </button>
          ) : (
            <p className="text-[var(--color-muted)] text-sm">{products.length} товаров</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/posts/ad/new')}
            className="flex items-center gap-2 px-4 min-h-[44px] rounded-xl bg-[var(--bg-3)] border border-[var(--color-border)] text-[var(--color-text)] text-sm font-semibold hover:border-[#22c55e]/40 transition-all"
          >
            <Megaphone size={15} /> Создать рекламу
          </button>
          <button
            onClick={() => navigate('/products/new')}
            className="flex items-center gap-2 px-4 min-h-[44px] rounded-xl bg-[#22c55e] text-[#0d1512] text-sm font-semibold hover:bg-[#16a34a] transition-all shadow-lg"
          >
            <Plus size={15} /> Добавить
          </button>
        </div>
      </motion.div>

      {products.length === 0 ? (
        <div className="text-center py-24">
          <Package size={40} className="mx-auto text-[var(--color-muted)] opacity-20 mb-4" />
          <p className="text-[var(--color-muted)]">Нет товаров</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {products.map((p, i) => {
            const busy = busyIds.includes(p.id);
            return (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                onClick={() => navigate(`/products/${p.id}`)}
                className="glass-card rounded-2xl overflow-hidden cursor-pointer group p-0 flex flex-col"
              >
                <div className="aspect-video bg-[rgba(255,255,255,0.03)] relative">
                  {p.media?.[0] ? (
                    <img
                      src={resolveMedia(p.media[0])}
                      alt={p.title}
                      loading="lazy"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Package size={28} className="text-[var(--color-muted)] opacity-20" />
                    </div>
                  )}
                  <span
                    className={`absolute top-3 right-3 px-2.5 py-1 rounded-full text-[10px] font-semibold ${
                      p.isActive ? 'bg-emerald-400/10 text-emerald-400' : 'bg-red-400/10 text-red-400'
                    }`}
                  >
                    {p.isActive ? 'Активен' : 'Скрыт'}
                  </span>
                  {p.isAd && (
                    <span className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-[#22c55e] text-[#0d1512] text-[10px] font-extrabold uppercase">
                      Реклама
                    </span>
                  )}
                </div>

                <div className="p-4 flex flex-col flex-1">
                  <h3 className="text-sm font-semibold text-[var(--color-text)] line-clamp-2 mb-2">{p.title}</h3>
                  <p className="text-[#22c55e] font-bold text-sm mb-3">{formatPrice(p.price)}</p>

                  {p.isAd && (
                    <p className="text-[11px] text-[var(--color-muted)] mb-3 leading-snug">
                      Реклама показывается в ленте после подтверждения оплаты.
                    </p>
                  )}

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(p.id);
                    }}
                    disabled={busy}
                    className="mt-auto flex items-center justify-center gap-1.5 px-3 min-h-[44px] rounded-lg bg-white/[0.04] text-[var(--color-muted)] text-xs font-medium hover:text-[var(--color-text)] hover:bg-white/[0.08] disabled:opacity-50 transition-all"
                  >
                    {busy ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : p.isActive ? (
                      <EyeOff size={12} />
                    ) : (
                      <Eye size={12} />
                    )}
                    {p.isActive ? 'Скрыть' : 'Показать'}
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}