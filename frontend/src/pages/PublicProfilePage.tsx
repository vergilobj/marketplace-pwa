import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Package, ShieldCheck, Star, UserX, Store, FileText,
  MessageCircle, Heart, LayoutGrid,
} from 'lucide-react';
import api from '../api/axios';
import { getProducts } from '../api/products';
import { getFeed } from '../api/posts';
import { resolveMedia } from '../utils/media';
import { formatPrice } from '../utils/format';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { ApiProduct, ApiPost } from '../api/types';
import { PageSkeleton } from '../components/ui/Skeleton';

/**
 * A5.8: публичный профиль пользователя.
 *
 * Владелец: «нужно еще страницу чужих профилей открывать она не открывается».
 *
 * Что показываем: имя, роль, рейтинг (trustScore → бейдж), товары продавца и
 * его посты. Что НЕ показываем никогда: телефон, балансы, referral-код —
 * это приватные поля, и они не должны утечь на чужой профиль.
 *
 * Источники данных:
 *   GET /users/:id        — id, name, role (для чужого профиля бэкенд отдаёт
 *                           ровно этот минимум, B13);
 *   GET /bazar/users/:id/trust — trustScore и бейдж (403, если юзер не продавец);
 *   GET /products         — витрина; фильтр по продавцу на бэкенде отсутствует,
 *                           поэтому отбираем по sellerId на клиенте;
 *   GET /posts/feed       — посты автора, отбор по authorId там же.
 *
 * Приватные поля читаем ТОЛЬКО когда это свой профиль (бэкенд в этом случае
 * отдаёт полный объект) и всё равно их не рендерим — профиль публичный.
 */

type PublicUser = {
  id: string;
  name?: string | null;
  role?: string;
  avatar?: string | null;
  createdAt?: string;
};

type Trust = {
  trustScore?: number;
  badge?: string;
  verified?: boolean;
  isSeller?: boolean;
};

const ROLE_LABEL: Record<string, string> = {
  BUYER: 'Покупатель',
  SELLER: 'Продавец',
  MODERATOR: 'Партнёр',
  ADMIN: 'Администратор',
};

const BADGE_LABEL: Record<string, string> = {
  NEW: 'Новичок',
  TRUSTED: 'Проверенный',
  VERIFIED_SELLER: 'Надёжный продавец',
};

/** Продавец — тот, у кого есть витрина (или trust-эндпоинт так сказал). */
const isSellerRole = (role?: string) => role === 'SELLER' || role === 'ADMIN' || role === 'MODERATOR';

export default function PublicProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [user, setUser] = useState<PublicUser | null>(null);
  const [trust, setTrust] = useState<Trust | null>(null);
  const [products, setProducts] = useState<ApiProduct[]>([]);
  const [posts, setPosts] = useState<ApiPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [authRequired, setAuthRequired] = useState(false);
  const [tab, setTab] = useState<'products' | 'posts'>('products');

  useEffect(() => {
    if (!id) return;
    const userId = id;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError('');
      setAuthRequired(false);

      // Профиль — обязательный запрос: без него страница бессмысленна.
      try {
        const { data } = await api.get<PublicUser>(`/users/${userId}`);
        if (cancelled) return;
        setUser(data);
        // У продавца по умолчанию открываем витрину, у остальных — посты.
        setTab(isSellerRole(data.role) ? 'products' : 'posts');
      } catch (e: unknown) {
        if (cancelled) return;
        const status = (e as { response?: { status?: number } })?.response?.status;
        if (status === 401) {
          setAuthRequired(true);
          setError('Войдите, чтобы посмотреть профиль');
        } else if (status === 404) {
          setError('Пользователь не найден');
        } else {
          setError('Не удалось загрузить профиль');
        }
        setLoading(false);
        return;
      }

      // Всё остальное — необязательные дополнения: упавший trust или витрина
      // не должны прятать сам профиль.
      const [trustRes, productsRes, postsRes] = await Promise.allSettled([
        api.get<Trust>(`/bazar/users/${userId}/trust`).then((r) => r.data),
        getProducts({ page: 1, limit: 100, sort: 'newest' }),
        getFeed({ page: 1, limit: 100, sort: 'newest' }),
      ]);
      if (cancelled) return;

      if (trustRes.status === 'fulfilled') setTrust(trustRes.value);

      if (productsRes.status === 'fulfilled') {
        const items = productsRes.value?.items || [];
        setProducts(items.filter((p) => p.sellerId === userId && p.isActive !== false));
      }

      if (postsRes.status === 'fulfilled') {
        const items = postsRes.value?.items || [];
        // Посты автора; реклама уже отфильтрована бэкендом по факту оплаты (A5.7).
        setPosts(items.filter((p) => p.authorId === userId || p.adOwnerId === userId));
      }

      setLoading(false);
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // PERF-4: зелёный квадрат 40×40 → скелетон публичного профиля
  if (loading) {
    return <PageSkeleton rows={3} />;
  }

  if (error || !user) {
    return (
      <div className="max-w-xl mx-auto px-6 py-24 text-center">
        <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] flex items-center justify-center">
          <UserX size={28} className="text-[#22c55e]" />
        </div>
        <h1 className="text-2xl font-extrabold text-[var(--color-text)] mb-2">{error || 'Профиль недоступен'}</h1>
        <p className="text-sm text-[var(--color-muted)] mb-8">
          {authRequired
            ? 'Публичные профили доступны участникам площадки.'
            : 'Возможно, ссылка устарела или аккаунт удалён.'}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2.5">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 px-5 h-11 rounded-full border border-[var(--color-border)] text-[var(--color-text)] text-sm font-bold hover:border-[#22c55e]/40 transition-colors"
          >
            <ArrowLeft size={16} /> Назад
          </button>
          {authRequired ? (
            <Link
              to="/login"
              className="inline-flex items-center gap-2 px-5 h-11 rounded-full bg-[#22c55e] text-[#0b0e0d] text-sm font-bold hover:bg-[#16a34a] transition-colors"
            >
              Войти
            </Link>
          ) : (
            <Link
              to="/products"
              className="inline-flex items-center gap-2 px-5 h-11 rounded-full bg-[#22c55e] text-[#0b0e0d] text-sm font-bold hover:bg-[#16a34a] transition-colors"
            >
              <LayoutGrid size={16} /> В каталог
            </Link>
          )}
        </div>
      </div>
    );
  }

  const displayName = user.name?.trim() || 'Участник';
  const badge = trust?.badge || 'NEW';
  const seller = trust?.isSeller || isSellerRole(user.role);

  const tabs = [
    { key: 'products' as const, label: 'Товары', count: products.length, icon: <Store size={14} /> },
    { key: 'posts' as const, label: 'Посты', count: posts.length, icon: <FileText size={14} /> },
  ].filter((t) => (t.key === 'products' ? seller || products.length > 0 : true));

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div
        className="fixed inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 60% 40% at 50% -5%, rgba(34,197,94,0.10) 0%, transparent 60%)' }}
      />
      <div className="relative max-w-3xl mx-auto px-4 sm:px-6 pt-10 pb-20">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 text-[var(--color-muted)] hover:text-[var(--color-text)] mb-6 transition-colors text-sm"
        >
          <ArrowLeft size={16} /> Назад
        </button>

        {/* Шапка профиля */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] p-6"
        >
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#22c55e] to-[#34d399] flex items-center justify-center text-[#0d1512] text-2xl font-extrabold shrink-0 overflow-hidden">
              {user.avatar ? (
                <img src={resolveMedia(user.avatar)} alt={displayName} width={128} height={128} loading="lazy" decoding="async" className="w-full h-full object-cover" />
              ) : (
                displayName[0].toUpperCase()
              )}
            </div>

            <div className="flex-1 min-w-0">
              <h1 className="text-xl sm:text-2xl font-extrabold text-[var(--color-text)] break-words">{displayName}</h1>

              <div className="flex flex-wrap items-center gap-2 mt-2">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--color-muted)] bg-[var(--bg-3)] border border-[var(--color-border)] px-2.5 py-1 rounded-full">
                  {seller ? <Store size={12} /> : <UserX size={12} />}
                  {ROLE_LABEL[user.role || ''] || 'Участник'}
                </span>

                {/* Рейтинг: trustScore публичен только у продавцов (N9/N16) */}
                {typeof trust?.trustScore === 'number' && (
                  <span
                    className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full border ${
                      trust.verified
                        ? 'text-[#22c55e] border-[#22c55e]/40 bg-[#22c55e]/10'
                        : 'text-[var(--color-muted)] border-[var(--color-border)] bg-[var(--bg-3)]'
                    }`}
                    title={`Рейтинг доверия: ${trust.trustScore}`}
                  >
                    <Star size={12} fill={trust.verified ? 'currentColor' : 'none'} />
                    {BADGE_LABEL[badge] || 'Новичок'}
                    <span className="opacity-70">· {trust.trustScore.toFixed(2)}</span>
                  </span>
                )}

                {trust?.verified && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#22c55e]">
                    <ShieldCheck size={12} /> Проверен площадкой
                  </span>
                )}
              </div>

              {user.createdAt && (
                <p className="text-[11px] text-[var(--color-muted)] mt-2">
                  На площадке с {format(new Date(user.createdAt), 'd MMMM yyyy', { locale: ru })}
                </p>
              )}

              <div className="flex flex-wrap gap-4 mt-4">
                <div>
                  <div className="text-lg font-extrabold text-[var(--color-text)]">{products.length}</div>
                  <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">товаров</div>
                </div>
                <div>
                  <div className="text-lg font-extrabold text-[var(--color-text)]">{posts.length}</div>
                  <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">постов</div>
                </div>
              </div>
            </div>
          </div>

          <p className="mt-5 text-[11px] text-[var(--color-muted)] flex items-center gap-1.5">
            <ShieldCheck size={12} className="text-[#22c55e]" />
            Телефон и баланс скрыты — площадка не показывает чужие контакты.
          </p>
        </motion.div>

        {/* Табы */}
        {tabs.length > 0 && (
          <div className="flex items-center gap-2 mt-6 mb-4 overflow-x-auto no-scrollbar">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`inline-flex items-center gap-1.5 px-4 min-h-[44px] rounded-lg text-sm font-bold whitespace-nowrap transition-colors ${
                  tab === t.key
                    ? 'bg-[#22c55e] text-[#0d1512]'
                    : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'
                }`}
              >
                {t.icon}
                {t.label} ({t.count})
              </button>
            ))}
          </div>
        )}

        {/* Товары */}
        {tab === 'products' && (
          products.length === 0 ? (
            <div className="text-center py-16">
              <Package size={36} className="mx-auto text-[var(--color-muted)] opacity-25 mb-3" />
              <p className="text-sm text-[var(--color-muted)]">Пока нет товаров</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {products.map((p, i) => (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  onClick={() => navigate(`/products/${p.id}`)}
                  className="rounded-2xl overflow-hidden cursor-pointer bg-[var(--color-surface)] border border-[var(--color-border)] hover:border-[#22c55e]/40 transition-colors group"
                >
                  <div className="aspect-square bg-[var(--bg-3)] overflow-hidden">
                    {p.media?.[0] ? (
                      <img
                        src={resolveMedia(p.media[0])}
                        alt={p.title}
                        loading="lazy"
                        decoding="async"
                        width={640}
                        height={640}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Package size={24} className="text-[var(--color-faint)]" />
                      </div>
                    )}
                  </div>
                  <div className="p-3">
                    <div className="text-[13px] font-medium text-[var(--color-text)] line-clamp-2 mb-1">{p.title}</div>
                    <div className="text-[13px] font-bold text-[#22c55e]">{formatPrice(p.price)}</div>
                  </div>
                </motion.div>
              ))}
            </div>
          )
        )}

        {/* Посты */}
        {tab === 'posts' && (
          posts.length === 0 ? (
            <div className="text-center py-16">
              <FileText size={36} className="mx-auto text-[var(--color-muted)] opacity-25 mb-3" />
              <p className="text-sm text-[var(--color-muted)]">Пока нет постов</p>
            </div>
          ) : (
            <div className="space-y-2">
              {posts.map((p, i) => (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  onClick={() => navigate(`/posts/${p.id}`)}
                  className="rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] p-4 cursor-pointer hover:border-[#22c55e]/40 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[11px] text-[var(--color-muted)]">
                      {p.createdAt ? format(new Date(p.createdAt), 'd MMM, HH:mm', { locale: ru }) : ''}
                    </span>
                    {p.isAd && (
                      <span className="text-[9px] font-extrabold uppercase text-[#0d1512] bg-[#22c55e] px-1.5 py-0.5 rounded-full">
                        Реклама
                      </span>
                    )}
                  </div>
                  <div className="text-[15px] font-bold text-[var(--color-text)]">{p.title}</div>
                  {p.content && (
                    <div className="text-[12px] text-[var(--color-muted)] line-clamp-2 mt-1">{p.content}</div>
                  )}
                  <div className="flex items-center gap-3 mt-2.5 text-[11px] text-[var(--color-muted)]">
                    <span className="inline-flex items-center gap-1">
                      <Heart size={12} /> {p.likeCount ?? 0}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <MessageCircle size={12} /> {p.commentCount ?? 0}
                    </span>
                  </div>
                </motion.div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}