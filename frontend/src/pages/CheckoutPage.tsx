import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ShoppingBag, ShieldCheck, ArrowLeft, Copy, Check, Loader2, ArrowRight, Clock } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { createOrder, getOrderPaymentStatus } from '../api/orders';
import { QRCodeSVG } from 'qrcode.react';
import toast from 'react-hot-toast';

type Payment = { depositAddress?: string | null; clientRef?: string | null; status?: string; };

const PAYMENT_WINDOW_MS = 1 * 60 * 1000;

export default function CheckoutPage() {
  const navigate = useNavigate();
  const { cart, clearCart } = useApp();
  const [loading, setLoading] = useState(false);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const total = cart.reduce((s: number, i: any) => s + i.price * i.quantity, 0);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // Таймер 15 минут на оплату
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => {
      const left = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setTimeLeft(left);
      if (left <= 0) {
        // счёт истёк — сбрасываем, возвращаем кнопку
        setPayment(null);
        setOrderId(null);
        setExpiresAt(null);
        toast.error('Время оплаты истекло. Создайте новый счёт.');
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  // Поллинг статуса оплаты
  useEffect(() => {
    if (!orderId || !payment?.depositAddress) return;
    pollRef.current = setInterval(async () => {
      try {
        const st = await getOrderPaymentStatus(orderId);
        setPayment((prev) => ({ ...prev, status: st.status }));
        if (st.status === 'CONFIRMED' || st.status === 'SWEPT') {
          if (pollRef.current) clearInterval(pollRef.current);
          toast.success('Оплата подтверждена!');
          clearCart();
          navigate('/orders');
        }
      } catch { /* продолжаем поллить */ }
    }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, payment?.depositAddress]);

  const handleOrder = async () => {
    setLoading(true);
    try {
      let lastOrder: any = null;
      for (const item of cart) {
        lastOrder = await createOrder(item.productId, item.price * item.quantity);
      }
      const pay: Payment = lastOrder?.payment || {};
      setOrderId(lastOrder?.id ?? null);
      if (pay.depositAddress) {
        setPayment({ depositAddress: pay.depositAddress, clientRef: pay.clientRef, status: pay.status || 'PENDING' });
        setExpiresAt(Date.now() + PAYMENT_WINDOW_MS);
        toast.success('Счёт создан. Оплатите USDT (BSC).');
      } else {
        setPayment({ status: pay.status || 'PENDING' });
      }
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Ошибка');
    } finally { setLoading(false); }
  };

  const copyAddress = async () => {
    if (!payment?.depositAddress) return;
    try {
      await navigator.clipboard.writeText(payment.depositAddress);
      setCopied(true);
      toast.success('Адрес скопирован');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Не удалось скопировать');
    }
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  };

  if (cart.length === 0 && !payment) {
    return (
      <div className="relative min-h-screen overflow-x-hidden">
        <div className="fixed inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse 60% 40% at 50% -5%, rgba(34,197,94,0.10) 0%, transparent 60%)' }} />
        <div className="relative max-w-xl mx-auto px-6 py-24 text-center">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-[var(--color-surface)] flex items-center justify-center"><ShoppingBag size={32} className="text-[var(--color-faint)]" /></div>
          <h1 className="text-3xl font-extrabold text-[var(--color-text)] mb-2">Пусто</h1>
          <p className="text-[var(--color-muted)] mb-6">Нечего оплачивать.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div className="fixed inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse 60% 40% at 50% -5%, rgba(34,197,94,0.10) 0%, transparent 60%)' }} />
      <div className="relative max-w-2xl mx-auto px-4 sm:px-6 pt-10 pb-20">
        <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-[var(--color-muted)] hover:text-[var(--color-text)] mb-6 transition-colors text-sm"><ArrowLeft size={16} /> Назад</button>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="rounded-[26px] bg-[var(--color-surface)] border border-[var(--color-border)] p-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full bg-[#22c55e] animate-pulse" />
            <span className="text-[11px] uppercase tracking-[0.3em] text-[var(--color-muted)]">безопасный чеккаут</span>
          </div>
          <h1 className="font-extrabold leading-[1.05] tracking-tight text-[var(--color-text)]" style={{ fontSize: 'clamp(2rem, 6vw, 3.5rem)' }}>
            <span style={{ background: 'linear-gradient(90deg, #22c55e, #34d399)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Оплата</span>
          </h1>

          {cart.length > 0 && (
            <>
              <div className="space-y-3 mb-6">
                {cart.map((item: any) => (
                  <div key={item.productId} className="flex justify-between items-center py-2 border-b border-[var(--color-border)]">
                    <span className="text-sm text-[var(--color-text)]">{item.title} × {item.quantity}</span>
                    <span className="text-sm font-bold text-[#22c55e]">{(item.price * item.quantity).toLocaleString('en-US', { maximumFractionDigits: 2 })} USDT</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between items-center mb-6">
                <span className="text-base font-bold text-[var(--color-text)]">Итого</span>
                <span className="text-xl font-extrabold text-[#22c55e]">{total.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDT</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-[var(--color-muted)] mb-6"><ShieldCheck size={14} className="text-[#22c55e]" /> Безопасная оплата через платформу</div>

              {/* Кнопка — только пока нет активного счёта */}
              {!payment?.depositAddress && (
                <button onClick={handleOrder} disabled={loading} className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-[#22c55e] text-[#0d1512] font-extrabold text-base hover:bg-[#16a34a] transition-colors shadow-[0_12px_32px_-8px_rgba(34,197,94,0.5)] disabled:opacity-50">
                  <span>{loading ? 'Оформление...' : 'Создать счёт'}</span><ArrowRight size={18} />
                </button>
              )}
            </>
          )}

          {payment?.depositAddress && (
            <div className="mt-6 rounded-2xl bg-[var(--bg-3)] border border-[#22c55e]/20 p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-bold text-[var(--color-text)]">Оплатите USDT (BSC) на адрес:</p>
                {timeLeft > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#22c55e]">
                    <Clock size={14} /> {formatTime(timeLeft)}
                  </span>
                )}
              </div>
              <div className="mb-4 flex justify-center">
                <div className="w-full bg-white rounded-2xl p-4">
                  <QRCodeSVG value={payment.depositAddress} className="w-full h-auto" />
                </div>
              </div>
              <div className="relative mt-2">
                <code className="block w-full pl-3 pr-12 py-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] text-xs text-[#34d399] break-all font-mono">{payment.depositAddress}</code>
                <button onClick={copyAddress} className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-lg text-[var(--color-muted)] hover:text-[#22c55e] hover:bg-[var(--bg-3)] transition-colors" title="Копировать адрес">
                  {copied ? <Check size={16} className="text-[#22c55e]" /> : <Copy size={16} />}
                </button>
              </div>
              <div className="flex items-center gap-2 mt-4 text-xs text-[var(--color-muted)]"><Loader2 size={14} className="animate-spin text-[#22c55e]" /> Ожидание подтверждения транзакции (BSC)...</div>
              <p className="mt-2 text-[11px] text-[var(--color-faint)]">Статус: {payment.status || 'PENDING'}</p>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}