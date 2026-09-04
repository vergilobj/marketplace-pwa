import { Heart, ShoppingCart, Plus, Minus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useApp } from '../context/AppContext';

const GS = { background: 'linear-gradient(135deg, #FF579B 0%, #9C6AFF 50%, #1DB4FF 100%)' } as const;

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
      whileHover={{ y: -6 }}
      whileTap={{ scale: 0.98 }}
      onClick={() => navigate(`/products/${product.id}`)}
      className="group glass-card overflow-hidden cursor-pointer flex flex-col h-full p-0"
    >
      <div className="relative overflow-hidden h-48 bg-[rgba(255,255,255,0.03)] shrink-0">
        {product.media?.[0] ? (
          <img src={product.media[0]} alt={product.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center"><ShoppingCart size={32} className="text-white/10" /></div>
        )}

        <div className="absolute top-3 right-3 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-all duration-200 translate-x-2 group-hover:translate-x-0">
          <button onClick={(e) => { e.stopPropagation(); toggleFavorite(product.id); }} className={`p-2.5 rounded-full backdrop-blur-xl transition-all ${fav ? 'bg-[#FF579B] text-white shadow-lg shadow-[rgba(255,87,155,0.4)]' : 'bg-black/50 text-white hover:bg-black/70'}`}>
            <Heart size={16} fill={fav ? 'currentColor' : 'none'} />
          </button>
          {!inCart && (
            <button onClick={(e) => { e.stopPropagation(); addToCart(product); }} style={GS} className="p-2.5 rounded-full text-white backdrop-blur-xl transition-all shadow-lg">
              <ShoppingCart size={16} />
            </button>
          )}
        </div>

        <div className="absolute bottom-3 left-3">
          <span className="px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-xl text-base font-bold text-white shadow-lg">{price}</span>
        </div>
      </div>

      <div className="p-4 flex flex-col flex-1">
        <h3 className="font-semibold text-[15px] text-[var(--color-text)] line-clamp-2 mb-2 group-hover:text-[#FF579B] transition-colors flex-1">{product.title}</h3>
        {product.seller?.name && (
          <div className="flex items-center gap-2 mb-3">
            <span style={GS} className="w-5 h-5 rounded-full text-white text-[9px] font-bold flex items-center justify-center shrink-0">{product.seller.name[0]}</span>
            <span className="text-xs text-[var(--color-muted)] font-medium">{product.seller.name}</span>
          </div>
        )}

        {inCart ? (
          <div className="mt-auto flex items-center justify-between gap-1 bg-[rgba(255,87,155,0.08)] border border-[rgba(255,87,155,0.2)] rounded-full px-2 py-1.5" onClick={e => e.stopPropagation()}>
            <button onClick={(e) => { e.stopPropagation(); updateQuantity(product.id, -1); }} className="p-1.5 rounded-full hover:bg-[rgba(255,255,255,0.08)] text-[#FF579B] hover:text-[#ff7ab0] transition-all">
              <Minus size={14} />
            </button>
            <span className="text-sm font-bold text-[var(--color-text)] min-w-[24px] text-center">{quantity}</span>
            <button onClick={(e) => { e.stopPropagation(); addToCart(product); }} className="p-1.5 rounded-full hover:bg-[rgba(255,255,255,0.08)] text-[#FF579B] hover:text-[#ff7ab0] transition-all">
              <Plus size={14} />
            </button>
          </div>
        ) : (
          <button onClick={(e) => { e.stopPropagation(); addToCart(product); }} style={GS} className="mt-auto w-full flex items-center justify-center gap-2 px-4 py-3 rounded-full text-white text-sm font-semibold transition-all shadow-[0_8px_24px_rgba(255,87,155,0.3)] hover:scale-[1.02]">
            <ShoppingCart size={15} />
            В корзину
          </button>
        )}
      </div>
    </motion.div>
  );
}