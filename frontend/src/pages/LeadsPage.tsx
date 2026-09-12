import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { usePaginatedList } from '../hooks/usePaginatedList';
import { bazarDeals, DEAL_STATUS_RU } from '../api/bazar';
import type { BazarDeal } from '../api/bazar';
import { resolveMedia } from '../utils/media';
import { formatPrice } from '../utils/format';

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
  } = usePaginatedList<BazarDeal>(
    ({ page, limit }) => bazarDeals('seller', { page, limit }),
    LEADS_PAGE_SIZE,
    isAuthenticated,
  );

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-6">
        <div className="flex justify-center py-24">
          <div className="w-8 h-8 rounded-full border-2 border-[#22c55e] border-t-transparent animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-6 pb-20">
      <h1 className="text-2xl font-bold text-white mb-1">Лиды</h1>
      <p className="text-sm text-[var(--color-muted)] mb-6">Входящие заявки покупателей по вашим товарам</p>

      {!loading && deals.length === 0 ? (
        <div
          className="rounded-3xl py-16 text-center"
          style={{ background: '#0d1210', border: '1px solid rgba(34,197,94,0.12)' }}
        >
          <div className="text-sm text-[var(--color-muted)]">Пока нет входящих лидов</div>
        </div>
      ) : (
        <>
          <div className="space-y-3">
          {deals.map((d) => (
            <button
              key={d.id}
              onClick={() => navigate(`/bazar?dealId=${d.id}`)}
              className="w-full text-left rounded-2xl p-4 transition-colors hover:border-[#22c55e]/40"
              style={{ background: '#0d1210', border: '1px solid rgba(34,197,94,0.12)' }}
            >
              <div className="flex items-start gap-3">
                {d.product?.media?.[0] ? (
                  <img
                    src={resolveMedia(d.product.media[0])}
                    alt=""
                    width={48}
                    height={48}
                    loading="lazy"
                    decoding="async"
                    className="w-12 h-12 rounded-xl object-cover shrink-0"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-xl shrink-0 bg-[rgba(255,255,255,0.04)]" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-white truncate">
                      {d.product?.title ?? 'Сделка'}
                    </span>
                    <span
                      className="shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-md"
                      style={{ color: '#34d399', background: 'rgba(52,211,153,0.12)' }}
                    >
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
                className="px-5 min-h-[44px] rounded-full text-[var(--color-text)] text-sm font-semibold transition-colors hover:border-[#22c55e]/40"
                style={{ background: '#0d1210', border: '1px solid rgba(34,197,94,0.12)' }}
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