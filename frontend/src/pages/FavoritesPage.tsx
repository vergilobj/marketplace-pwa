import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Heart, ShoppingCart, Trash2, Plus, Minus } from 'lucide-react';
import { motion } from 'framer-motion';
import { useApp } from '../context/AppContext';
import { getProducts } from '../api/products';

export default function FavoritesPage() {
  const navigate = useNavigate();
  const { favorites, cart, toggleFavorite, addToCart, updateQuantity } = useApp();
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getProducts({ limit: 2000 }).then(res => setProducts((res.items || []).filter((p: any) => favorites.includes(p.id)))).finally(() => setLoading(false));
  }, [favorites]);

  if (loading) return <div className="flex justify-center py-32"><div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 animate-pulse" /></div>;

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold text-white mb-2">Избранное</h1>
        <p className="text-white/60 text-sm mb-8">{products.length} товаров</p>
      </motion.div>

      {products.length === 0 ? (
        <div className="flex items-center justify-center py-24 w-full"><div className="text-center"><div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center"><Heart size={32} className="text-white/10" /></div><p className="text-white/60 mb-4">Нет избранных товаров</p><button onClick={() => navigate('/products')} className="px-6 py-3 rounded-xl bg-indigo-500 text-white text-sm font-semibold hover:bg-indigo-400 shadow-lg shadow-indigo-500/25 transition-all">В каталог</button></div></div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {products.map((product, i) => {
            const price = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 0 }).format(product.price);
            const ci = cart.find((item: any) => item.productId === product.id);
            const inC = !!ci;
            const q = ci?.quantity || 1;
            return (
              <motion.div key={product.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                className="group glass-card rounded-2xl overflow-hidden cursor-pointer flex flex-col h-full p-0"
                onClick={() => navigate(`/products/${product.id}`)}>
                <div className="aspect-square bg-[rgba(255,255,255,0.03)] relative shrink-0">
                  {product.media?.[0] && <img src={product.media[0]} alt={product.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />}
                  <span className="absolute bottom-3 left-3 px-3 py-1.5 rounded-xl bg-black/70 backdrop-blur-xl text-sm font-bold text-white">{price}</span>
                </div>
                <div className="p-4 flex flex-col flex-1">
                  <h3 className="text-sm font-semibold text-white line-clamp-2 mb-3 group-hover:text-indigo-400 transition-colors flex-1">{product.title}</h3>
                  
                  <div className="mt-auto flex gap-2" onClick={e => e.stopPropagation()}>
                    {inC ? (
                      <div className="flex-1 flex items-center justify-between gap-1 bg-indigo-500/10 border border-indigo-500/20 rounded-xl px-2 py-2">
                        <button onClick={(e) => { e.stopPropagation(); updateQuantity(product.id, -1); }} className="p-1 rounded-lg hover:bg-white/[0.08] text-indigo-400 transition-all"><Minus size={13} /></button>
                        <span className="text-xs font-bold text-white min-w-[20px] text-center">{q}</span>
                        <button onClick={(e) => { e.stopPropagation(); addToCart(product); }} className="p-1 rounded-lg hover:bg-white/[0.08] text-indigo-400 transition-all"><Plus size={13} /></button>
                      </div>
                    ) : (
                      <button onClick={(e) => { e.stopPropagation(); addToCart(product); }} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-indigo-500 text-white text-xs font-semibold hover:bg-indigo-400 transition-all"><ShoppingCart size={13} /> В корзину</button>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); toggleFavorite(product.id); }} className="px-3 py-2 rounded-xl bg-rose-400/10 text-rose-400 text-xs font-semibold hover:bg-rose-400/20 transition-all shrink-0"><Trash2 size={13} /></button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
