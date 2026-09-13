import { Heart, ShoppingCart, Plus, Minus, Play } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { formatPrice } from "../utils/format";
import { resolveMedia } from '../utils/media';
import { buildGallery } from '../utils/video';
import type { ApiProduct } from '../api/types';

export default function ProductCard({ product }: { product: ApiProduct }) {
  const navigate = useNavigate();
  const { cart, addToCart, updateQuantity, toggleFavorite, isFavorite } = useApp();
  const fav = isFavorite(product.id);
  const cartItem = cart.find((item) => item.productId === product.id);
  const inCart = !!cartItem;
  const quantity = cartItem?.quantity || 1;
  const price = formatPrice(product.price);
  const gallery = buildGallery(product.media, product.videoUrl);
  const first = gallery[0] || null;

  return (
    <div
      onClick={() => navigate(`/products/${product.id}`)}
      className="group overflow-hidden cursor-pointer flex flex-col h-full bg-[var(--color-card)] rounded-xl border border-[var(--color-border)] hover:border-[#22c55e] transition-colors"
    >
      <div className="relative overflow-hidden h-44 bg-[var(--bg-3)] shrink-0">
        {/* Единая галерея: видео первым, фото после. */}
        {gallery.length > 0 ? (
          first?.type === 'video' ? (
            <video
              src={resolveMedia(first.src)}
              controls
              playsInline
              preload="metadata"
              className="w-full h-full object-cover bg-black"
              onClick={(e) => e.stopPropagation()}
            />
          ) : first?.type === 'embed' ? (
            <div className="w-full h-full flex items-center justify-center bg-black">
              <Play size={28} className="text-white/70" />
            </div>
          ) : (
            <img src={resolveMedia(first!.src)} alt={product.title} className="w-full h-full object-cover" loading="lazy" decoding="async" width={640} height={480} style={{ aspectRatio: '4 / 3' }} />
          )
        ) : (
          <div className="w-full h-full flex items-center justify-center"><ShoppingCart size={28} className="text-[var(--color-faint)]" /></div>
        )}

        {gallery.length > 1 && (
          <span className="absolute bottom-1.5 left-1.5 text-[10px] font-semibold text-white bg-black/60 rounded-full px-1.5 py-0.5">
            {gallery.length} медиа
          </span>
        )}

        {/* R15: на тач-устройствах hover нет — кнопка видна всегда (CSS .fav-btn) */}
        <button
          onClick={(e) => { e.stopPropagation(); toggleFavorite(product.id); }}
          aria-label={fav ? 'Убрать из избранного' : 'В избранное'}
          className="fav-btn absolute top-0.5 right-0.5 w-11 h-11 flex items-center justify-center"
        >
          <span className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${fav ? 'bg-[#22c55e] text-[#0d1512]' : 'bg-black/60 text-white opacity-0 group-hover:opacity-100'}`}>
            <Heart size={15} fill={fav ? 'currentColor' : 'none'} />
          </span>
        </button>
      </div>

      <div className="p-3 flex flex-col flex-1">
        <div className="text-sm font-medium text-[var(--color-text)] line-clamp-2 mb-1 flex-1" title={product.title}>{product.title}</div>
        {product.seller?.name && <div className="text-[11px] text-[var(--color-muted)] mb-2">{product.seller.name}</div>}

        <div className="flex items-center justify-between mt-1">
          <span className="text-[15px] font-semibold text-[#22c55e]">{price}</span>
          {inCart ? (
            <div className="flex items-center gap-0.5 border border-[var(--color-border)] rounded-lg -mx-1" onClick={e => e.stopPropagation()}>
              <button onClick={(e) => { e.stopPropagation(); updateQuantity(product.id, -1); }} aria-label="Меньше" className="w-11 h-11 flex items-center justify-center rounded-md hover:bg-[var(--bg-3)] text-[var(--color-text)]"><Minus size={13} /></button>
              <span className="text-sm font-medium min-w-[20px] text-center">{quantity}</span>
              <button onClick={(e) => { e.stopPropagation(); addToCart(product); }} aria-label="Больше" className="w-11 h-11 flex items-center justify-center rounded-md hover:bg-[var(--bg-3)] text-[var(--color-text)]"><Plus size={13} /></button>
            </div>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); addToCart(product); }}
              className="w-11 h-11 rounded-lg bg-[#22c55e] text-[#0d1512] hover:bg-[#16a34a] transition-colors flex items-center justify-center shrink-0"
              title="В корзину"
              aria-label="В корзину"
            >
              <ShoppingCart size={17} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
