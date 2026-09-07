import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { getMyOrders, updateOrderStatus } from '../api/orders';
import { PackageCheck, Clock, Truck, CheckCircle2, XCircle } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { formatPrice } from "../utils/format";

const statusConfig: Record<string, { icon: React.ReactNode; cls: string; label: string }> = {
  PENDING: { icon: <Clock size={14} />, cls: 'text-amber-400 bg-amber-400/10', label: 'ждёт' },
  PAID: { icon: <CheckCircle2 size={14} />, cls: 'text-[#22c55e] bg-[#22c55e]/10', label: 'оплачено' },
  SHIPPED: { icon: <Truck size={14} />, cls: 'text-[#34d399] bg-[#34d399]/10', label: 'едет' },
  COMPLETED: { icon: <PackageCheck size={14} />, cls: 'text-[#22c55e] bg-[#22c55e]/10', label: 'закрыто' },
  CANCELLED: { icon: <XCircle size={14} />, cls: 'text-red-400 bg-red-400/10', label: 'мимо' },
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  const fetchOrders = async () => { try { setLoading(true); const data = await getMyOrders(); setOrders(Array.isArray(data) ? data : []); } finally { setLoading(false); } };
  useEffect(() => { fetchOrders(); }, []);

  const handleStatus = async (id: string, status: string) => { try { await updateOrderStatus(id, status); toast.success('Статус обновлён'); fetchOrders(); } catch { toast.error('Ошибка'); } };
  const filtered = filter ? orders.filter(o => o.status === filter) : orders;

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

      <div className="relative max-w-3xl mx-auto px-4 sm:px-6 pt-10 pb-20">
        <h1 className="text-2xl font-bold text-[var(--color-text)] mb-1">Заказы</h1>
        <p className="text-[var(--color-muted)] text-sm mb-6">История сделок</p>

        <div className="flex gap-2 mb-6 overflow-x-auto pb-1 no-scrollbar">
          {['', 'PENDING', 'PAID', 'SHIPPED', 'COMPLETED', 'CANCELLED'].map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all shrink-0 ${
                filter === s
                  ? 'bg-[#22c55e] text-[#0d1512] shadow-[0_4px_20px_rgba(34,197,94,0.4)]'
                  : 'text-[var(--color-muted)] border border-[var(--color-border)] hover:text-[var(--color-text)] hover:border-[#22c55e]/40'
              }`}
            >
              {s ? statusConfig[s]?.label : 'Все'}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-16">
            <PackageCheck size={40} className="mx-auto text-[var(--color-faint)] mb-4" />
            <p className="text-[var(--color-muted)]">Пока пусто. Начни с малого — выбери что-нибудь на базаре.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((order, i) => {
              const cfg = statusConfig[order.status] || statusConfig.PENDING;
              return (
                <motion.div key={order.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] p-5 hover:border-[#22c55e]/40 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="font-bold text-[var(--color-text)] text-sm truncate">{order.product?.title || `Заказ #${order.id.slice(0, 8)}`}</h3>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${cfg.cls}`}>{cfg.icon}{cfg.label}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-[var(--color-muted)]">
                        <span className="font-bold text-[#22c55e]">{formatPrice(order.amount)}</span>
                        <span>•</span>
                        <span>{order.createdAt ? format(new Date(order.createdAt), 'd MMM, HH:mm', { locale: ru }) : ''}</span>
                      </div>
                    </div>
                    {order.status === 'PENDING' && <button onClick={() => handleStatus(order.id, 'CANCELLED')} className="text-xs text-red-400 hover:text-red-300 font-bold px-3 py-1.5 rounded-full hover:bg-red-400/10 transition-all shrink-0">Отменить</button>}
                    {order.status === 'SHIPPED' && <button onClick={() => handleStatus(order.id, 'COMPLETED')} className="text-xs text-[#22c55e] hover:text-[#34d399] font-bold px-3 py-1.5 rounded-full hover:bg-[#22c55e]/10 transition-all shrink-0">Подтвердить</button>}
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