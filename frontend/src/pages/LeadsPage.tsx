import { useNavigate } from 'react-router-dom';
import { Loader2, Inbox } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { usePaginatedList } from '../hooks/usePaginatedList';
import { bazarDeals, DEAL_STATUS_RU } from '../api/bazar';
import type { BazarDeal } from '../api/bazar';
import { formatPrice } from '../utils/format';
import ErrorState from '../components/ui/ErrorState';
import EmptyState from '../components/ui/EmptyState';
import MediaImage from '../components/ui/MediaImage';
import { PageSkeleton } from '../components/ui/Skeleton';

const fmt = (s?: string | null) => {
  if (!s) return '';
  const d = new Date(s);
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

/**
 * L2: размер страницы лидов.
 *
 * `GET /bazar/deals` принимает page/limit (потолок 100), но отдаёт МАССИВ —
 * «есть ещё» выводится из длины страницы. До этого лиды грузились одним
 * запросом без параметров (дефолт 100), то есть у продавца с большим потоком
 * заявок список обрезался молча. Здесь — реальная постраничная догрузка:
 * infinite scroll (общий хук, `rootMargin: 200px` как в `ProductsPage`) плюс
 * кнопка «Показать ещё».
 */
const LEADS_PAGE_SIZE = 100;

/**
 * B2 (WAVE 2, п.3): страница приведена к общей системе.
 *
 * Было:
 *  - загрузка — зелёный спиннер в 24-пиксельном квадрате вместо скелетона;
 *    остальные списки проекта рисуют скелетон, поэтому layout прыгал именно
 *    здесь (спиннер не занимает высоту будущего списка);
 *  - пустое состояние — голая плашка без иконки и БЕЗ действия: тупик;
 *  - цвета заданы inline-хардкодом (`#0d1210`, `rgba(34,197,94,0.12)`),
 *    из-за чего страница не следовала теме и расходилась с соседними.
 *
 * Стало: `PageSkeleton` (как в OrdersPage), `EmptyState` с действием «К товарам»,
 * токены темы (`var(--color-surface)` / `var(--color-border)`) и `MediaImage`
 * с заглушкой на битую картинку.
 */
export default function LeadsPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  const {
    items: deals,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    loaderRef,
    error,
    reload,
  } = usePaginatedList<BazarDeal>(
    ({ page, limit }) => bazarDeals('seller', { page, limit }),
    LEADS_PAGE_SIZE,
    isAuthenticated,
  );

  // B2 п.3: скелетон вместо спиннера — тот же паттерн, что в OrdersPage.
  if (loading) {
    return <PageSkeleton rows={4} wide />;
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-6 pb-20">
      <h1 className="text-2xl font-bold text-[var(--color-text)] mb-1">Лиды</h1>
      <p className="text-sm text-[var(--color-muted)] mb-6">Входящие заявки покупателей по вашим товарам</p>

      {!loading && deals.length === 0 && error ? (
        /* HIGH-1: сбой загрузки — это НЕ «нет лидов». */
        <ErrorState
          message={error}
          description="Не получилось загрузить заявки. Проверь связь и попробуй ещё раз."
          onRetry={reload}
        />
      ) : !loading && deals.length === 0 ? (
        /* B2 п.3: было плашкой без иконки и без выхода — теперь общий EmptyState с действием. */
        <EmptyState
          icon={<Inbox size={32} />}
          title="Пока нет входящих лидов"
          description="Как только покупатель напишет по твоему товару, заявка появится здесь."
          headingLevel="h2"
          action={{ label: 'К товарам', onClick: () => navigate('/products') }}
        />
      ) : (
        <>
          <div className="space-y-3">
          {deals.map((d) => (
            <button
              key={d.id}
              onClick={() => navigate(`/bazar?dealId=${d.id}`)}
              className="w-full text-left rounded-2xl p-4 bg-[var(--color-surface)] border border-[var(--color-border)] transition-colors hover:border-[#22c55e]/40"
            >
              <div className="flex items-start gap-3">
                <MediaImage
                  src={d.product?.media?.[0]}
                  alt={d.product?.title ?? ''}
                  width={48}
                  height={48}
                  loading="lazy"
                  decoding="async"
                  className="w-12 h-12 rounded-xl object-cover shrink-0"
                  fallback={<div className="w-12 h-12 rounded-xl shrink-0 bg-[rgba(255,255,255,0.04)]" />}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-[var(--color-text)] truncate">
                      {d.product?.title ?? 'Сделка'}
                    </span>
                    <span className="shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-md text-emerald-400 bg-emerald-400/10">
                      {DEAL_STATUS_RU[d.status] ?? d.status}
                    </span>
                  </div>
                  <div className="text-[13px] text-[var(--color-muted)] mt-0.5">
                    Покупатель: <span className="text-[var(--color-text)]">{d.buyer?.name ?? '—'}</span>
                  </div>
                  {d.product?.price != null && (
                    <div className="text-[13px] font-bold text-[#22c55e] mt-0.5">
                      {formatPrice(d.product.price)}
                    </div>
                  )}
                  <div className="text-[11px] text-[var(--color-faint)] mt-1">
                    {d.lastMsgAt ? fmt(d.lastMsgAt) : ''}
                    {d.msgCount ? ` · ${d.msgCount} сообщ.` : ''}
                  </div>
                </div>
              </div>
            </button>
          ))}
          </div>

          {/* L2: маячок infinite scroll + ручная догрузка */}
          <div ref={loaderRef} className="py-8 flex flex-col items-center gap-2">
            {loadingMore && <Loader2 size={20} className="animate-spin text-[#22c55e]" />}
            {!loadingMore && hasMore && (
              <button
                type="button"
                onClick={loadMore}
                className="px-5 min-h-[44px] rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] text-sm font-semibold transition-colors hover:border-[#22c55e]/40"
              >
                Показать ещё
              </button>
            )}
            {!loadingMore && !hasMore && <span className="text-[var(--color-faint)] text-xs">Всё показали</span>}
          </div>
        </>
      )}
    </div>
  );
}