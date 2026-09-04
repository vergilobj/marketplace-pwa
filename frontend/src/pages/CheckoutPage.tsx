import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ShoppingBag,
  Sparkles,
  ShieldCheck,
  ArrowLeft,
  Copy,
  Check,
  Loader2,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { createOrder, getOrderPaymentStatus } from '../api/orders';
import toast from 'react-hot-toast';

type Payment = {
  depositAddress?: string | null;
  clientRef?: string | null;
  status?: string;
};

export default function CheckoutPage() {
  const navigate = useNavigate();
  const { cart, clearCart } = useApp();
  const [loading, setLoading] = useState(false);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const total = cart.reduce((s: number, i: any) => s + i.price * i.quantity, 0);

  // Очищаем таймер при размонтировании.
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Поллинг статуса оплаты пока не CONFIRMED / SWEPT.
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
      } catch {
        // не критично — продолжаем поллить
      }
    }, 3000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, payment?.depositAddress]);

  const handleOrder = async () => {
    setLoading(true);
    try {
      // Создаём заказы; берём инфу об оплате из последнего.
      let lastOrder: any = null;
      for (const item of cart) {
        lastOrder = await createOrder(item.productId, item.price * item.quantity);
      }
      // Ответ createOrder содержит order + payment (depositAddress).
      const pay: Payment = lastOrder?.payment || {};
      setOrderId(lastOrder?.id ?? null);
      if (pay.depositAddress) {
        setPayment({ depositAddress: pay.depositAddress, clientRef: pay.clientRef, status: pay.status || 'PENDING' });
        toast.success('Заказ оформлен! Оплатите USDT (BSC).');
      } else {
        setPayment({ status: pay.status || 'PENDING' });
      }
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Ошибка');
    } finally {
      setLoading(false);
    }
  };

  const copyAddress = async () => {
    if (!payment?.depositAddress) return;
    try {
      await navigator.clipboard.writeText(payment.depositAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Не удалось скопировать');
    }
  };

  if (cart.length === 0 && !payment) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-24 text-center">
        <ShoppingBag size={40} className="mx-auto text-white/10 mb-4" />
        <p className="text-white/50">Корзина пуста</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-2 text-white/50 hover:text-white mb-6 transition-colors text-sm"
      >
        <ArrowLeft size={16} />
        Назад
      </button>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card rounded-[26px] p-6"
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
            <ShoppingBag size={18} className="text-white" />
          </div>
          <h1 className="text-xl font-bold text-white">Оформление заказа</h1>
        </div>

        {cart.length > 0 && (
          <>
            <div className="space-y-3 mb-6">
              {cart.map((item: any) => (
                <div
                  key={item.productId}
                  className="flex justify-between items-center py-2 border-b border-white/[0.04]"
                >
                  <span className="text-sm text-white">
                    {item.title} × {item.quantity}
                  </span>
                  <span className="text-sm font-bold text-white">
                    {new Intl.NumberFormat('ru-RU', {
                      style: 'currency',
                      currency: 'RUB',
                      minimumFractionDigits: 0,
                    }).format(item.price * item.quantity)}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex justify-between items-center mb-6">
              <span className="text-base font-bold text-white">Итого</span>
              <span className="text-xl font-extrabold text-indigo-400">
                {new Intl.NumberFormat('ru-RU', {
                  style: 'currency',
                  currency: 'RUB',
                  minimumFractionDigits: 0,
                }).format(total)}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-white/50 mb-6">
              <ShieldCheck size={14} className="text-emerald-400" />
              Безопасная оплата через платформу
            </div>
            <button
              onClick={handleOrder}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-semibold text-sm hover:from-indigo-400 transition-all shadow-lg disabled:opacity-50"
            >
              <Sparkles size={16} />
              {loading ? 'Оформление...' : 'Оплатить'}
            </button>
          </>
        )}

        {/* Карточка оплаты USDT (BSC) */}
        {payment?.depositAddress && (
          <div className="mt-6 glass border border-emerald-500/20 rounded-2xl p-5">
            <p className="text-sm font-bold text-white mb-1">
              Оплатите USDT (BSC) на адрес:
            </p>
            <div className="flex items-center gap-2 mt-2">
              <code className="flex-1 px-3 py-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-xs text-emerald-300 break-all font-mono">
                {payment.depositAddress}
              </code>
              <button
                onClick={copyAddress}
                className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-white text-xs font-semibold transition-colors shrink-0"
              >
                {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                {copied ? 'Готово' : 'Копировать'}
              </button>
            </div>
            <div className="flex items-center gap-2 mt-4 text-xs text-white/50">
              <Loader2 size={14} className="animate-spin text-indigo-400" />
              Ожидание подтверждения транзакции (BSC)...
            </div>
            <p className="mt-2 text-[11px] text-white/35">
              Статус: {payment.status || 'PENDING'}
            </p>
          </div>
        )}
      </motion.div>
    </div>
  );
}