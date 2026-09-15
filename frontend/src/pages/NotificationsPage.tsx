import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import api from '../api/axios';
import { Bell, Heart, MessageCircle, ShoppingBag, Gift, CheckCheck, Sparkles } from 'lucide-react';
import { pluralize, PLURAL, formatDate } from '../utils/format';
import toast from 'react-hot-toast';
import { PageSkeleton } from '../components/ui/Skeleton';
import ErrorState from '../components/ui/ErrorState';
import { useListError } from '../hooks/useListError';
import { errorMessage } from '../utils/error';

const icons: Record<string, React.ReactNode> = {
  like: <Heart size={13} className="text-red-400" />,
  comment: <MessageCircle size={13} className="text-[#34d399]" />,
  order: <ShoppingBag size={13} className="text-[#22c55e]" />,
  referral: <Gift size={13} className="text-amber-400" />,
  broadcast: <Bell size={13} className="text-[#34d399]" />,
  feedback: <MessageCircle size={13} className="text-[#22c55e]" />,
  consult: <Sparkles size={13} className="text-[#34d399]" />,
};

/**
 * ЭТАП 4 §4.5 п.3: куда ведёт уведомление по типу.
 *
 * До правки клик по уведомлению только помечал его прочитанным — юзер видел
 * «Ответ по обращению…» и не мог перейти к самому ответу. Теперь типы с
 * `relatedId` открывают тред обращения; остальные остаются некликабельными.
 */
function notificationHref(n: { type?: string; relatedId?: string | null }): string | null {
  const related = n?.relatedId;
  if (!related) return null;
  if (n.type === 'feedback' || n.type === 'consult') return `/feedback/${related}`;
  if (n.type === 'order') return `/orders?highlight=${related}`;
  return null;
}

/**
 * FIX-REST фикс 9: было 100.
 *
 * С PAGE_SIZE=100 кнопка «Показать ещё» не появлялась НИ У КОГО: проверено на
 * боевой БД — самый «богатый» пользователь имеет 24 уведомления, а всего
 * пользователей с >=100 уведомлений ровно 0. Условие `hasMore` не выполнялось
 * никогда, то есть код кнопки существовал, но был мёртвым.
 *
 * Побочная проблема того же 100: список рендерится со stagger-анимацией
 * (`transition={{delay: i*0.02}}`), поэтому сотая карточка появлялась бы
 * через 2 секунды после открытия страницы.
 *
 * 20 — тот же дефолт, что у «страничных» списков бэкенда
 * (PAGINATION_DEFAULT_LIMIT), и он совпадает с тем, что фронт уже ждёт от
 * остальных лент. Первый экран рисуется быстрее, анимация укладывается в
 * 0.4с, а кнопка начинает работать для пользователей с >20 уведомлений.
 */
const PAGE_SIZE = 20;

export default function NotificationsPage() {
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  /** Пришло ровно PAGE_SIZE — значит, скорее всего, есть ещё. */
  const [hasMore, setHasMore] = useState(false);
  // HIGH-1: сбой загрузки → ErrorState, а не «Пока тихо».
  const { error, setError, retryKey, errorProps } = useListError();

  useEffect(() => {
    api.get('/notifications', { params: { page: 1, limit: PAGE_SIZE } })
      .then(r => { const data = r.data || []; setList(data); setHasMore(data.length >= PAGE_SIZE); setError(''); })
      .catch((e) => setError(errorMessage(e, 'Не удалось загрузить уведомления')))
      .finally(() => setLoading(false));
  }, [retryKey, setError]);

  const loadMore = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const next = page + 1;
      const r = await api.get('/notifications', { params: { page: next, limit: PAGE_SIZE } });
      const data: any[] = r.data || [];
      setPage(next);
      setHasMore(data.length >= PAGE_SIZE);
      // дедуп по id — защита от сдвига страниц, если пришло новое уведомление
      setList(p => {
        const seen = new Set(p.map(n => n.id));
        return [...p, ...data.filter(n => !seen.has(n.id))];
      });
    } catch (e) {
      toast.error(errorMessage(e, 'Не удалось загрузить ещё уведомления — попробуй ещё раз'));
    }
    finally { setLoadingMore(false); }
  };

  /**
   * B4 §1/§7: было `catch { toast.error('Ошибка') }` и успех без объекта
   * («Всё прочитано» — что именно?). Теперь и ошибка, и успех говорят
   * конкретно, о чём речь.
   */
  const readAll = async () => {
    try {
      await api.patch('/notifications/read-all');
      setList(p => p.map(n => ({ ...n, isRead: true })));
      toast.success('Все уведомления прочитаны');
    } catch (e: unknown) {
      toast.error(errorMessage(e, 'Не удалось отметить уведомления прочитанными — попробуй ещё раз'));
    }
  };
  const markRead = async (id:string) => { try { await api.patch(`/notifications/${id}/read`); setList(p => p.map(n=>n.id===id?{...n,isRead:true}:n)); } catch { /* ignore */ } };

  // PERF-4: зелёный квадрат 40×40 → скелетон списка уведомлений
  if (loading) return <PageSkeleton rows={4} />;

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div className="fixed inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 60% 40% at 50% -5%, rgba(34,197,94,0.10) 0%, transparent 60%)'
      }} />

      <div className="relative max-w-2xl mx-auto px-4 sm:px-6 pt-10 pb-20">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Уведомления</h1>
          {list.some(n=>!n.isRead) && <button onClick={readAll} className="tap-link gap-1 text-sm text-[#22c55e] hover:text-[#34d399] font-bold"><CheckCheck size={14} /> Прочитать все</button>}
        </div>
        {list.length > 0 && <p className="text-[var(--color-muted)] text-sm mb-6">{pluralize(list.filter(n=>!n.isRead).length, PLURAL.уведомление)} непрочитанных</p>}

        {list.length === 0 && error ? (
          <ErrorState {...errorProps} />
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-20 h-20 rounded-full bg-[var(--color-surface)] flex items-center justify-center mb-6">
              <Bell size={32} className="text-[var(--color-faint)]" />
            </div>
            <p className="text-lg font-bold text-[var(--color-text)] mb-1">Пока тихо</p>
            <p className="text-[var(--color-muted)] text-sm mb-4">Лайки, комментарии и заказы будут тут</p>
            {/* LOW-1: у пустого состояния не было выхода — юзер упирался в тупик. */}
            <Link to="/products" className="inline-flex items-center justify-center px-5 min-h-[44px] rounded-full bg-[#22c55e] text-[#0d1512] text-sm font-bold hover:bg-[#16a34a] transition-colors">
              В каталог
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {list.map((n,i) => {
              const href = notificationHref(n);
              const Card: React.ElementType = href ? Link : 'div';
              return (
              <motion.div
                key={n.id}
                initial={{opacity:0,x:-8}}
                animate={{opacity:1,x:0}}
                transition={{delay:i*0.02}}
              >
                <Card
                  {...(href ? { to: href } : {})}
                  onClick={()=>!n.isRead&&markRead(n.id)}
                  className={`block rounded-2xl p-4 cursor-pointer transition-all bg-[var(--color-surface)] border ${!n.isRead ? 'border-[#22c55e]/40' : 'border-[var(--color-border)]'} hover:border-[#22c55e]/60`}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl bg-[var(--bg-3)] flex items-center justify-center shrink-0">{icons[n.type]||<Bell size={13}/>}</div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${!n.isRead?'font-bold text-[var(--color-text)]':'text-[var(--color-muted)]'}`}>{n.message}</p>
                      <p className="text-[11px] text-[var(--color-faint)] mt-1">{formatDate(n.createdAt, 'relative')}</p>
                    </div>
                    {!n.isRead && <div className="w-2 h-2 rounded-full bg-[#22c55e] shrink-0 mt-1.5"/>}
                  </div>
                </Card>
              </motion.div>
              );
            })}
          </div>
        )}

        {list.length > 0 && hasMore && (
          <div className="flex justify-center mt-6">
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="px-6 py-2.5 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] text-sm font-bold text-[var(--color-text)] hover:border-[#22c55e]/60 transition-all disabled:opacity-50"
            >
              {loadingMore ? 'Загрузка…' : 'Показать ещё'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}