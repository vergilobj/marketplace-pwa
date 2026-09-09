import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { getMyOrders, updateOrderStatus, payOrder, getOrderPayStatus } from '../api/orders';
import { PackageCheck, Clock, Truck, CheckCircle2, XCircle, Copy, Check, X, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { QRCodeSVG } from 'qrcode.react';
import { formatPrice } from "../utils/format";

const statusConfig: Record<string, { icon: React.ReactNode; cls: string; label: string }> = {
  PENDING: { icon: <Clock size={14} />, cls: 'text-amber-400 bg-amber-400/10', label: 'ждёт' },
  PAID: { icon: <CheckCircle2 size={14} />, cls: 'text-[#22c55e] bg-[#22c55e]/10', label: 'оплачено' },
  SHIPPED: { icon: <Truck size={14} />, cls: 'text-[#34d399] bg-[#34d399]/10', label: 'едет' },
  COMPLETED: { icon: <PackageCheck size={14} />, cls: 'text-[#22c55e] bg-[#22c55e]/10', label: 'закрыто' },
  CANCELLED: { icon: <XCircle size={14} />, cls: 'text-red-400 bg-red-400/10', label: 'мимо' },
};

type PayModalState = {
  orderId: string;
  amount: number;
  depositAddress: string | null;
  clientRef: string | null;
  status: string;
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [pay, setPay] = useState<PayModalState | null>(null);
  const [creatingPay, setCreatingPay] = useState(false);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchOrders = async () => { try { setLoading(true); const data = await getMyOrders(); setOrders(Array.isArray(data) ? data : []); } finally { setLoading(false); } };
  useEffect(() => { fetchOrders(); }, []);

  // Очистка поллинга при размонтировании
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // Поллинг статуса оплаты каждые 5 сек, пока открыта модалка
  useEffect(() => {
    if (!pay?.depositAddress) return;
    pollRef.current = setInterval(async () => {
      try {
        const st = await getOrderPayStatus(pay.orderId);
        const status = st.status || 'PENDING';
        setPay((prev) => prev ? { ...prev, status } : prev);
        if (status === 'CONFIRMED' || status === 'SWEPT' || status === 'PAID') {
          if (pollRef.current) clearInterval(pollRef.current);
          toast.success('Оплата поступила');
          setPay(null);
          fetchOrders();
        }
      } catch { /* продолжаем поллить */ }
    }, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pay?.orderId, pay?.depositAddress]);

  const handleStatus = async (id: string, status: string) => { try { await updateOrderStatus(id, status); toast.success('Статус обновлён'); fetchOrders(); } catch { toast.error('Ошибка'); } };

  const handlePay = async (order: any) => {
    setCreatingPay(true);
    try {
      const t = toast.loading('Создаю платёж…');
      const res = await payOrder(order.id);
      toast.dismiss(t);
      setPay({
        orderId: order.id,
        amount: order.amount,
        depositAddress: res.depositAddress || null,
        clientRef: res.clientRef || null,
        status: res.status || 'PENDING',
      });
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Не удалось создать платёж');
    } finally {
      setCreatingPay(false);
    }
  };

  const copyAddress = async () => {
    if (!pay?.depositAddress) return;
    try {
      await navigator.clipboard.writeText(pay.depositAddress);
      setCopied(true);
      toast.success('Адрес скопирован');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Не удалось скопировать');
    }
  };

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
                    <div className="flex items-center gap-2 shrink-0">
                      {order.status === 'PENDING' && (
                        <>
                          <button onClick={() => handlePay(order)} disabled={creatingPay} className="inline-flex items-center gap-1.5 text-xs font-bold px-3.5 py-1.5 rounded-full bg-[#22c55e] text-[#0d1512] hover:bg-[#16a34a] transition-colors disabled:opacity-50">
                            {creatingPay ? <Loader2 size={13} className="animate-spin" /> : null}Оплатить
                          </button>
                          <button onClick={() => handleStatus(order.id, 'CANCELLED')} className="text-xs text-red-400 hover:text-red-300 font-bold px-3 py-1.5 rounded-full hover:bg-red-400/10 transition-all shrink-0">Отменить</button>
                        </>
                      )}
                      {order.status === 'SHIPPED' && <button onClick={() => handleStatus(order.id, 'COMPLETED')} className="text-xs text-[#22c55e] hover:text-[#34d399] font-bold px-3 py-1.5 rounded-full hover:bg-[#22c55e]/10 transition-all shrink-0">Подтвердить</button>}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* Модалка оплаты */}
      {pay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" onClick={() => { if (pollRef.current) clearInterval(pollRef.current); setPay(null); }} />
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="relative w-full max-w-sm rounded-3xl bg-[#0b0e0d] border border-[#22c55e]/30 p-6 shadow-2xl">
            <button onClick={() => { if (pollRef.current) clearInterval(pollRef.current); setPay(null); }} className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-lg text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--bg-3)] transition-colors">
              <X size={16} />
            </button>

            <p className="text-[11px] uppercase tracking-[0.3em] text-[var(--color-muted)] mb-2">оплата заказа</p>
            <h2 className="text-xl font-extrabold text-[var(--color-text)] mb-1">USDT (BSC)</h2>
            <p className="text-2xl font-extrabold text-[#22c55e] mb-4">{formatPrice(pay.amount)}</p>

            {pay.depositAddress ? (
              <>
                <div className="mb-4 flex justify-center">
                  <div className="w-full max-w-[240px] bg-white rounded-2xl p-3">
                    <QRCodeSVG value={pay.depositAddress} className="w-full h-auto" />
                  </div>
                </div>
                <div className="relative">
                  <code className="block w-full pl-3 pr-12 py-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] text-xs text-[#34d399] break-all font-mono">{pay.depositAddress}</code>
                  <button onClick={copyAddress} className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-lg text-[var(--color-muted)] hover:text-[#22c55e] hover:bg-[var(--bg-3)] transition-colors">
                    {copied ? <Check size={16} className="text-[#22c55e]" /> : <Copy size={16} />}
                  </button>
                </div>
                <div className="flex items-center gap-2 mt-4 text-xs text-[var(--color-muted)]">
                  <Loader2 size={14} className="animate-spin text-[#22c55e]" />
                  Ожидание подтверждения…
                </div>
                <p className="mt-2 text-[11px] text-[var(--color-faint)]">Статус: {pay.status}</p>
              </>
            ) : (
              <div className="flex items-center gap-2 text-sm text-[var(--color-muted)] py-6">
                <Loader2 size={16} className="animate-spin text-[#22c55e]" /> Создаю платёж…
              </div>
            )}
          </motion.div>
        </div>
      )}
    </div>
  );
}