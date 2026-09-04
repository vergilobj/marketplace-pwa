import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { getMyOrders, updateOrderStatus } from '../api/orders';
import { PackageCheck, Clock, Truck, CheckCircle2, XCircle } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { formatPrice } from "../utils/format";

const GS = { background: 'linear-gradient(135deg, #6366f1 0%, #38bdf8 50%, #38bdf8 100%)' } as const;

const statusConfig: Record<string, { icon: React.ReactNode; variant: string; label: string }> = {
  PENDING: { icon: <Clock size={14} />, variant: 'warning', label: 'Ожидает' },
  PAID: { icon: <CheckCircle2 size={14} />, variant: 'success', label: 'Оплачен' },
  SHIPPED: { icon: <Truck size={14} />, variant: 'info', label: 'Отправлен' },
  COMPLETED: { icon: <PackageCheck size={14} />, variant: 'success', label: 'Завершён' },
  CANCELLED: { icon: <XCircle size={14} />, variant: 'danger', label: 'Отменён' },
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  const fetchOrders = async () => { try { setLoading(true); const data = await getMyOrders(); setOrders(Array.isArray(data) ? data : []); } finally { setLoading(false); } };
  useEffect(() => { fetchOrders(); }, []);

  const handleStatus = async (id: string, status: string) => { try { await updateOrderStatus(id, status); toast.success('Статус обновлён'); fetchOrders(); } catch { toast.error('Ошибка'); } };
  const filtered = filter ? orders.filter(o => o.status === filter) : orders;

  if (loading) return <div className="flex justify-center py-32"><div style={GS} className="w-10 h-10 rounded-2xl animate-pulse" /></div>;

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}><h1 className="text-2xl font-bold text-[var(--color-text)] mb-2">Заказы</h1><p className="text-[var(--color-muted)] text-sm mb-6">История покупок и продаж</p></motion.div>

      <div className="flex gap-2 mb-6 flex-wrap">{['', 'PENDING', 'PAID', 'SHIPPED', 'COMPLETED', 'CANCELLED'].map(s => <button key={s} onClick={() => setFilter(s)} className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${filter === s ? 'text-[var(--color-text)] shadow-[0_6px_20px_rgba(201,242,103,0.3)]' : 'bg-[rgba(255,255,255,0.04)] text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[rgba(255,255,255,0.08)]'}`} style={filter === s ? GS : undefined}>{s ? statusConfig[s]?.label : 'Все'}</button>)}</div>

      {filtered.length === 0 ? <div className="text-center py-16"><PackageCheck size={40} className="mx-auto text-[var(--color-faint)] mb-4" /><p className="text-[var(--color-muted)]">Заказов нет</p></div> : (
        <div className="space-y-3">
          {filtered.map((order, i) => {
            const cfg = statusConfig[order.status] || statusConfig.PENDING;
            return (
              <motion.div key={order.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="glass-card rounded-2xl p-5 hover:border-[rgba(201,242,103,0.4)]">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2"><h3 className="font-semibold text-[var(--color-text)] text-sm truncate">{order.product?.title || `Заказ #${order.id.slice(0, 8)}`}</h3><span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[rgba(255,255,255,0.04)] text-[11px] font-semibold text-[var(--color-muted)]">{cfg.icon}{cfg.label}</span></div>
                    <div className="flex items-center gap-3 text-xs text-[var(--color-muted)]"><span>{formatPrice(order.amount)}</span><span>•</span><span>{order.createdAt ? format(new Date(order.createdAt), 'd MMM, HH:mm', { locale: ru }) : ''}</span></div>
                  </div>
                  {order.status === 'PENDING' && <button onClick={() => handleStatus(order.id, 'CANCELLED')} className="text-xs text-red-400 hover:text-red-300 font-medium px-3 py-1.5 rounded-full hover:bg-red-400/5 transition-all">Отменить</button>}
                  {order.status === 'SHIPPED' && <button onClick={() => handleStatus(order.id, 'COMPLETED')} className="text-xs text-emerald-400 hover:text-emerald-300 font-medium px-3 py-1.5 rounded-full hover:bg-emerald-400/5 transition-all">Подтвердить</button>}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}