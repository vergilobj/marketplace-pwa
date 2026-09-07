import { Heart, ShoppingCart, Plus, Minus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { formatPrice } from "../utils/format";

export default function ProductCard({ product }: { product: any }) {
  const navigate = useNavigate();
  const { cart, addToCart, updateQuantity, toggleFavorite, isFavorite } = useApp();
  const fav = isFavorite(product.id);
  const cartItem = cart.find((item: any) => item.productId === product.id);
  const inCart = !!cartItem;
  const quantity = cartItem?.quantity || 1;
  const price = formatPrice(product.price);

  return (
    <div
      onClick={() => navigate(`/products/${product.id}`)}
      className="group overflow-hidden cursor-pointer flex flex-col h-full bg-[var(--color-card)] rounded-xl border border-[var(--color-border)] hover:border-[#22c55e] transition-colors"
    >
      <div className="relative overflow-hidden h-44 bg-[var(--bg-3)] shrink-0">
        {product.media?.[0] ? (
          <img src={product.media[0]} alt={product.title} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center"><ShoppingCart size={28} className="text-[var(--color-faint)]" /></div>
        )}

        <button
          onClick={(e) => { e.stopPropagation(); toggleFavorite(product.id); }}
          className={`absolute top-2 right-2 p-2 rounded-lg transition-colors ${fav ? 'bg-[#22c55e] text-white' : 'bg-black/50 text-white opacity-0 group-hover:opacity-100'}`}
        >
          <Heart size={15} fill={fav ? 'currentColor' : 'none'} />
        </button>
      </div>

      <div className="p-3 flex flex-col flex-1">
        <div className="text-sm font-medium text-[var(--color-text)] line-clamp-2 mb-1 flex-1">{product.title}</div>
        {product.seller?.name && <div className="text-[11px] text-[var(--color-muted)] mb-2">{product.seller.name}</div>}

        <div className="flex items-center justify-between mt-1">
          <span className="text-[15px] font-semibold text-[#22c55e]">{price}</span>
          {inCart ? (
            <div className="flex items-center gap-1 border border-[var(--color-border)] rounded-lg px-1.5 py-1" onClick={e => e.stopPropagation()}>
              <button onClick={(e) => { e.stopPropagation(); updateQuantity(product.id, -1); }} className="p-1 rounded-md hover:bg-[var(--bg-3)] text-[var(--color-text)]"><Minus size={13} /></button>
              <span className="text-sm font-medium min-w-[20px] text-center">{quantity}</span>
              <button onClick={(e) => { e.stopPropagation(); addToCart(product); }} className="p-1 rounded-md hover:bg-[var(--bg-3)] text-[var(--color-text)]"><Plus size={13} /></button>
            </div>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); addToCart(product); }}
              className="w-8 h-8 rounded-lg bg-[#22c55e] text-white hover:bg-[#16a34a] transition-colors flex items-center justify-center"
              title="В корзину"
            >
              <ShoppingCart size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
