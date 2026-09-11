import { useNavigate } from 'react-router-dom';
import { ShoppingBag, Minus, Plus, ArrowLeft, ArrowRight } from 'lucide-react';
import EmptyState from '../components/ui/EmptyState';
import { motion, AnimatePresence } from 'framer-motion';
import { useApp } from '../context/AppContext';
import { formatPrice } from "../utils/format";
import { resolveMedia } from '../utils/media';

export default function CartPage() {
  const navigate = useNavigate();
  const { cart, updateQuantity } = useApp();

  const total = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const formatted = formatPrice(total);

  if (cart.length === 0) {
    return (
      <div className="relative min-h-screen overflow-x-hidden">
        <div className="fixed inset-0 pointer-events-none" style={{
          background: 'radial-gradient(ellipse 60% 40% at 50% -5%, rgba(34,197,94,0.10) 0%, transparent 60%)'
        }} />
        <div className="relative max-w-xl mx-auto px-6 py-24">
          <EmptyState
            icon={<ShoppingBag size={32} />}
            title="Пусто"
            description="Как в твоём кошельке до зарплаты."
            action={{ label: 'На базар', onClick: () => navigate('/') }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div className="fixed inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 60% 40% at 50% -5%, rgba(34,197,94,0.10) 0%, transparent 60%)'
      }} />

      <div className="relative max-w-2xl mx-auto px-4 sm:px-6 pt-10 pb-32">
        <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-[var(--color-muted)] hover:text-[var(--color-text)] mb-6 transition-colors text-sm">
          <ArrowLeft size={16} /> Назад
        </button>

        <h1 className="text-2xl font-bold text-[var(--color-text)] mb-1">Корзина</h1>
        <div className="mb-6" />

        <div className="space-y-3 mb-8">
          <AnimatePresence>
            {cart.map((item) => (
              <motion.div
                key={item.productId}
                layout
                exit={{ opacity: 0, x: 24 }}
                onClick={() => navigate(`/products/${item.productId}`)}
                className="flex items-center gap-4 p-3.5 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] cursor-pointer hover:border-[#22c55e]/40 transition-colors"
              >
                <div className="w-16 h-16 rounded-xl overflow-hidden bg-[var(--bg-3)] shrink-0">
                  {item.media?.[0]
                    ? <img src={resolveMedia(item.media[0])} alt={item.title} className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center"><ShoppingBag size={20} className="text-[var(--color-faint)]" /></div>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-[var(--color-text)] truncate">{item.title}</div>
                  <div className="text-sm font-extrabold text-[#22c55e]">{formatPrice(item.price * item.quantity)}</div>
                </div>
                <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                  <button onClick={() => updateQuantity(item.productId, -1)} className="w-8 h-8 rounded-lg border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--bg-3)] flex items-center justify-center transition-all"><Minus size={13} /></button>
                  <span className="text-sm font-bold text-[var(--color-text)] min-w-[20px] text-center">{item.quantity}</span>
                  <button onClick={() => updateQuantity(item.productId, 1)} className="w-8 h-8 rounded-lg border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--bg-3)] flex items-center justify-center transition-all"><Plus size={13} /></button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        <div className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] p-5">
          <div className="flex justify-between items-center mb-4">
            <span className="text-[var(--color-muted)] text-sm">Итого</span>
            <span className="text-2xl font-extrabold text-[var(--color-text)]">{formatted}</span>
          </div>
          <button onClick={() => navigate('/checkout')} className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-[#22c55e] text-[#0d1512] font-extrabold text-base hover:bg-[#16a34a] transition-colors shadow-[0_12px_32px_-8px_rgba(34,197,94,0.5)]">
            <span>Оформить заказ</span><ArrowRight size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}