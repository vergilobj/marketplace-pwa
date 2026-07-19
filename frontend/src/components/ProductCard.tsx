import { Heart, ShoppingCart, Plus, Minus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useApp } from '../context/AppContext';

export default function ProductCard({ product }: { product: any }) {
  const navigate = useNavigate();
  const { cart, addToCart, updateQuantity, toggleFavorite, isFavorite } = useApp();
  const fav = isFavorite(product.id);
  const cartItem = cart.find((item: any) => item.productId === product.id);
  const inCart = !!cartItem;
  const quantity = cartItem?.quantity || 1;
  const price = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 0 }).format(product.price);

  return (
    <motion.div
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.98 }}
      onClick={() => navigate(`/products/${product.id}`)}
      className="group bg-[#1a1a24] border border-white/[0.06] rounded-2xl overflow-hidden hover:border-white/[0.15] hover:shadow-2xl hover:shadow-black/40 transition-all duration-300 cursor-pointer flex flex-col h-full"
    >
      <div className="relative overflow-hidden h-48 bg-[#111115] shrink-0">
        {product.media?.[0] ? (
          <img src={product.media[0]} alt={product.title} className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-500" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center"><ShoppingCart size={32} className="text-white/10" /></div>
        )}
        
        <div className="absolute top-3 right-3 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-all duration-200 translate-x-2 group-hover:translate-x-0">
          <button onClick={(e) => { e.stopPropagation(); toggleFavorite(product.id); }} className={`p-2.5 rounded-xl backdrop-blur-xl transition-all ${fav ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/30' : 'bg-black/60 text-white hover:bg-black/80'}`}>
            <Heart size={16} fill={fav ? 'currentColor' : 'none'} />
          </button>
          {!inCart && (
            <button onClick={(e) => { e.stopPropagation(); addToCart(product); }} className="p-2.5 rounded-xl bg-black/60 text-white hover:bg-indigo-500 backdrop-blur-xl transition-all">
              <ShoppingCart size={16} />
            </button>
          )}
        </div>

        <div className="absolute bottom-3 left-3">
          <span className="px-3 py-1.5 rounded-xl bg-black/70 backdrop-blur-xl text-base font-bold text-white shadow-lg">{price}</span>
        </div>
      </div>

      <div className="p-4 flex flex-col flex-1">
        <h3 className="font-semibold text-[15px] text-white line-clamp-2 mb-2 group-hover:text-indigo-400 transition-colors flex-1">{product.title}</h3>
        {product.seller?.name && (
          <div className="flex items-center gap-2 mb-3">
            <span className="w-5 h-5 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 text-white text-[9px] font-bold flex items-center justify-center shrink-0">{product.seller.name[0]}</span>
            <span className="text-xs text-white/60 font-medium">{product.seller.name}</span>
          </div>
        )}
        
        {/* Quantity control or Add button */}
        {inCart ? (
          <div className="mt-auto flex items-center justify-between gap-1 bg-indigo-500/10 border border-indigo-500/20 rounded-xl px-2 py-1.5" onClick={e => e.stopPropagation()}>
            <button onClick={(e) => { e.stopPropagation(); updateQuantity(product.id, -1); }} className="p-1.5 rounded-lg hover:bg-white/[0.08] text-indigo-400 hover:text-indigo-300 transition-all">
              <Minus size={14} />
            </button>
            <span className="text-sm font-bold text-white min-w-[24px] text-center">{quantity}</span>
            <button onClick={(e) => { e.stopPropagation(); addToCart(product); }} className="p-1.5 rounded-lg hover:bg-white/[0.08] text-indigo-400 hover:text-indigo-300 transition-all">
              <Plus size={14} />
            </button>
          </div>
        ) : (
          <button onClick={(e) => { e.stopPropagation(); addToCart(product); }} className="mt-auto w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-indigo-500 text-white text-sm font-semibold hover:bg-indigo-400 shadow-lg shadow-indigo-500/25 transition-all">
            <ShoppingCart size={15} />
            В корзину
          </button>
        )}
      </div>
    </motion.div>
  );
}
