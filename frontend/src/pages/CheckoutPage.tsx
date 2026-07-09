import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ShoppingBag, Sparkles, ShieldCheck, ArrowLeft } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { createOrder } from '../api/orders';
import toast from 'react-hot-toast';

export default function CheckoutPage() {
  const navigate = useNavigate();
  const { cart, clearCart } = useApp();
  const [loading, setLoading] = useState(false);
  const total = cart.reduce((s:number,i:any)=>s+i.price*i.quantity,0);

  const handleOrder = async () => {
    setLoading(true);
    try { for (const item of cart) { await createOrder(item.productId, item.price*item.quantity); } clearCart(); toast.success('Заказ оформлен!'); navigate('/orders'); }
    catch (e:any) { toast.error(e.response?.data?.message||'Ошибка'); } finally { setLoading(false); }
  };

  if (cart.length===0) return <div className="max-w-2xl mx-auto px-6 py-24 text-center"><ShoppingBag size={40} className="mx-auto text-white/10 mb-4"/><p className="text-white/50">Корзина пуста</p></div>;

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <button onClick={()=>navigate(-1)} className="inline-flex items-center gap-2 text-white/50 hover:text-white mb-6 transition-colors text-sm"><ArrowLeft size={16}/>Назад</button>
      <motion.div initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} className="bg-[#1a1a24] border border-white/[0.06] rounded-2xl p-6">
        <div className="flex items-center gap-3 mb-6"><div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center"><ShoppingBag size={18} className="text-white"/></div><h1 className="text-xl font-bold text-white">Оформление заказа</h1></div>
        <div className="space-y-3 mb-6">{cart.map((item:any)=><div key={item.productId} className="flex justify-between items-center py-2 border-b border-white/[0.04]"><span className="text-sm text-white">{item.title} × {item.quantity}</span><span className="text-sm font-bold text-white">{new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',minimumFractionDigits:0}).format(item.price*item.quantity)}</span></div>)}</div>
        <div className="flex justify-between items-center mb-6"><span className="text-base font-bold text-white">Итого</span><span className="text-xl font-extrabold text-indigo-400">{new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',minimumFractionDigits:0}).format(total)}</span></div>
        <div className="flex items-center gap-2 text-xs text-white/50 mb-6"><ShieldCheck size={14} className="text-emerald-400"/>Безопасная оплата через платформу</div>
        <button onClick={handleOrder} disabled={loading} className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-semibold text-sm hover:from-indigo-400 transition-all shadow-lg disabled:opacity-50"><Sparkles size={16}/>{loading?'Оформление...':'Оплатить'}</button>
      </motion.div>
    </div>
  );
}
