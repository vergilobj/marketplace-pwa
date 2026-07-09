import { useNavigate, Link } from 'react-router-dom';
import { Trash2, ShoppingBag, Heart, Minus, Plus, ArrowLeft, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useApp } from '../context/AppContext';

export default function CartPage() {
  const navigate = useNavigate();
  const { cart, removeFromCart, updateQuantity, moveToFavorites } = useApp();

  const total = cart.reduce((s: number, i: any) => s + i.price * i.quantity, 0);
  const formatted = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 0 }).format(total);

  if (cart.length === 0) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-24 text-center">
        <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center"><ShoppingBag size={32} className="text-white/35" /></div>
        <h1 className="text-2xl font-bold text-white mb-2">Корзина пуста</h1>
        <p className="text-white/60 mb-6">Добавьте товары из каталога</p>
        <Link to="/" className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-semibold text-sm hover:from-indigo-400 transition-all shadow-lg shadow-indigo-500/25"><ShoppingBag size={16} /> К покупкам</Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-white/50 hover:text-white mb-6 transition-colors text-sm"><ArrowLeft size={16} /> Назад</button>
      <h1 className="text-2xl font-bold text-white mb-6">Корзина ({cart.length})</h1>
      
      <div className="space-y-3 mb-8">
        <AnimatePresence>
          {cart.map((item: any) => (
            <motion.div key={item.productId} exit={{ opacity: 0, x: 20 }} className="flex items-center gap-4 p-4 bg-[#1a1a24] border border-white/[0.06] rounded-2xl">
              <div className="w-16 h-16 rounded-xl bg-[#111115] shrink-0" />
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-white truncate">{item.title}</h3>
                <p className="text-sm text-indigo-400 font-bold">{new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 0 }).format(item.price * item.quantity)}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => updateQuantity(item.productId, -1)} className="p-1.5 rounded-lg bg-white/[0.04] text-white/60 hover:text-white hover:bg-white/[0.08] transition-all"><Minus size={14} /></button>
                <span className="text-sm font-semibold text-white w-6 text-center">{item.quantity}</span>
                <button onClick={() => updateQuantity(item.productId, 1)} className="p-1.5 rounded-lg bg-white/[0.04] text-white/60 hover:text-white hover:bg-white/[0.08] transition-all"><Plus size={14} /></button>
              </div>
              <button onClick={() => moveToFavorites(item.productId)} className="p-2 rounded-lg text-white/50 hover:text-rose-400 hover:bg-rose-400/5 transition-all"><Heart size={16} /></button>
              <button onClick={() => removeFromCart(item.productId)} className="p-2 rounded-lg text-white/50 hover:text-red-400 hover:bg-red-400/5 transition-all"><Trash2 size={16} /></button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <div className="bg-[#1a1a24] border border-white/[0.06] rounded-2xl p-5">
        <div className="flex justify-between items-center mb-4"><span className="text-white/50 text-sm">Итого</span><span className="text-xl font-bold text-white">{formatted}</span></div>
        <button onClick={() => navigate('/checkout')} className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-semibold text-sm hover:from-indigo-400 transition-all shadow-lg shadow-indigo-500/25"><Sparkles size={16} /> Оформить заказ</button>
      </div>
    </div>
  );
}
