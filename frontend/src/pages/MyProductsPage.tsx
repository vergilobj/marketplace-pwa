import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import api from '../api/axios';
import { useNavigate } from 'react-router-dom';
import { Package, Plus, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';

export default function MyProductsPage() {
  const navigate = useNavigate();
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { api.get('/products/my').then(r=>setProducts(r.data||[])).finally(()=>setLoading(false)); }, []);

  const toggle = async (id:string) => { try { await api.patch(`/products/${id}/toggle-active`); toast.success('Обновлено'); setProducts(p=>p.map(x=>x.id===id?{...x,isActive:!x.isActive}:x)); } catch { toast.error('Ошибка'); } };

  if (loading) return <div className="flex justify-center py-32"><div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 animate-pulse" /></div>;

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <motion.div initial={{opacity:0,y:-10}} animate={{opacity:1,y:0}} className="flex items-center justify-between mb-8"><div><h1 className="text-2xl font-bold text-white mb-1">Мои товары</h1><p className="text-white/60 text-sm">{products.length} товаров</p></div><button onClick={()=>navigate('/products/new')} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-500 text-white text-sm font-semibold hover:bg-indigo-400 transition-all shadow-lg"><Plus size={15}/>Добавить</button></motion.div>

      {products.length===0 ? <div className="text-center py-24"><Package size={40} className="mx-auto text-white/10 mb-4"/><p className="text-white/60">Нет товаров</p></div> : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">{products.map((p,i)=>(<motion.div key={p.id} initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} transition={{delay:i*.04}} onClick={()=>navigate(`/products/${p.id}`)} className="bg-[#1a1a24] border border-white/[0.06] rounded-2xl overflow-hidden hover:border-white/[0.12] transition-all cursor-pointer group"><div className="aspect-video bg-[#111115] relative">{p.media?.[0]?<img src={p.media[0]} alt={p.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"/>:<div className="w-full h-full flex items-center justify-center"><Package size={28} className="text-white/10"/></div>}<span className={`absolute top-3 right-3 px-2.5 py-1 rounded-full text-[10px] font-semibold ${p.isActive?'bg-emerald-400/10 text-emerald-400':'bg-red-400/10 text-red-400'}`}>{p.isActive?'Активен':'Скрыт'}</span></div><div className="p-4"><h3 className="text-sm font-semibold text-white line-clamp-2 mb-2">{p.title}</h3><p className="text-indigo-400 font-bold text-sm mb-3">{new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',minimumFractionDigits:0}).format(p.price)}</p><button onClick={e=>{e.stopPropagation();toggle(p.id)}} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] text-white/60 text-xs font-medium hover:text-white hover:bg-white/[0.08] transition-all"><EyeOff size={12}/>{p.isActive?'Скрыть':'Показать'}</button></div></motion.div>))}</div>
      )}
    </div>
  );
}
