import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ShoppingCart, Minus, Plus, ArrowLeft, ChevronLeft, ChevronRight, Heart, Sparkles, Video, PackageX, LayoutGrid } from 'lucide-react';
import { getProductById, getSimilarProducts } from '../api/products';
import { createOrder, getOrderPaymentStatus } from '../api/orders';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '../hooks/useAuth';
import { useApp } from '../context/AppContext';
import { resolveMedia } from '../utils/media';
import { getVideoEmbed } from '../utils/video';
import { formatPrice } from '../utils/format';
import toast from 'react-hot-toast';
import { errorMessage } from '../utils/error';
import type { ApiProduct } from '../api/types';

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { addToCart, toggleFavorite, isFavorite } = useApp();
  const [product, setProduct] = useState<ApiProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState(false);
  const [error, setError] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [similar, setSimilar] = useState<ApiProduct[]>([]);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [payment, setPayment] = useState<{
    depositAddress?: string | null;
    status?: string | null;
    orderId?: string;
  } | null>(null);
  const [activeImg, setActiveImg] = useState(0);
  const similarRef = useRef<HTMLDivElement>(null);

  const scrollSimilar = (dir: number) => {
    similarRef.current?.scrollBy({ left: dir * 220, behavior: 'smooth' });
  };

  useEffect(() => {
    if (!id) return;
    const productId = id;
    const loadProduct = async () => {
      try {
        const data = await getProductById(productId);
        setProduct(data);
        try {
          const sim = await getSimilarProducts(productId);
          setSimilar(sim || []);
        } catch {
          setSimilar([]);
        }
      } catch {
        setError('Товар не найден');
      } finally {
        setLoading(false);
      }
    };
    loadProduct();
  }, [id]);

  const handleBuy = async () => {
    if (!product) return;
    setBuying(true);
    setError('');
    try {
      const order = await createOrder(product.id, product.price * quantity);
      const pay = order?.payment || {};
      if (pay.depositAddress) {
        setPayment({ depositAddress: pay.depositAddress, status: pay.status || 'PENDING', orderId: order.id });
        const poll = setInterval(async () => {
          try {
            const st = await getOrderPaymentStatus(order.id);
            setPayment(prev => prev ? { ...prev, status: st.status } : prev);
            if (st.status === 'CONFIRMED' || st.status === 'SWEPT') {
              clearInterval(poll);
              setTimeout(() => navigate('/orders'), 1200);
            }
          } catch { /* продолжаем поллить */ }
        }, 3000);
      } else {
        navigate(`/orders?highlight=${order.id}`);
      }
    } catch (err: unknown) {
      setError(errorMessage(err, 'Ошибка при создании заказа'));
    } finally {
      setBuying(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-32">
        <div className="w-10 h-10 rounded-2xl bg-[var(--color-surface)] animate-pulse" />
      </div>
    );
  }

  // Загрузка завершена, но товара нет: сюда попадаем и по явной ошибке,
  // и если запрос отработал вхолостую. Дальше рендер идёт по непустому
  // product, поэтому сужаем тип один раз здесь.
  if (!product) {
    return (
      <div className="max-w-xl mx-auto px-6 py-24 text-center">
        <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] flex items-center justify-center">
          <PackageX size={28} className="text-[#22c55e]" />
        </div>
        <h1 className="text-2xl font-extrabold text-[var(--color-text)] mb-2">{error || 'Товар не найден'}</h1>
        <p className="text-sm text-[var(--color-muted)] mb-8">
          Возможно, товар сняли с продажи или ссылка устарела.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2.5">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 px-5 h-11 rounded-full border border-[var(--color-border)] text-[var(--color-text)] text-sm font-bold hover:border-[#22c55e]/40 hover:bg-[var(--color-surface)] transition-colors"
          >
            <ArrowLeft size={16} /> Назад
          </button>
          <button
            onClick={() => navigate('/products')}
            className="inline-flex items-center gap-2 px-5 h-11 rounded-full bg-[#22c55e] text-[#0b0e0d] text-sm font-bold hover:bg-[#16a34a] transition-colors"
          >
            <LayoutGrid size={16} /> В каталог
          </button>
        </div>
      </div>
    );
  }

  const media = Array.isArray(product.media) ? product.media : [];
  const videoEmbed = getVideoEmbed(product.videoUrl);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-6 pb-20">
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-[var(--color-muted)] hover:text-[var(--color-text)] mb-6 transition-colors text-sm">
        <ArrowLeft size={16} /> Назад
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        {/* Галерея */}
        <div>
          {/* Основное фото */}
          <div className="rounded-2xl overflow-hidden bg-[var(--color-surface)] border border-[var(--color-border)] aspect-square mb-3">
            {media[activeImg] ? (
              <img
                src={resolveMedia(media[activeImg])}
                alt={product.title}
                className="w-full h-full object-cover cursor-zoom-in"
                onClick={() => setSelectedImage(resolveMedia(media[activeImg]))}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[var(--color-faint)]">
                <ShoppingCart size={40} />
              </div>
            )}
          </div>

          {/* Таумбнейлы */}
          {media.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {media.map((url: string, idx: number) => (
                <button
                  key={idx}
                  onClick={() => setActiveImg(idx)}
                  className={`shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition-colors ${
                    idx === activeImg ? 'border-[#22c55e]' : 'border-[var(--color-border)] hover:border-[#22c55e]/40'
                  }`}
                >
                  <img src={resolveMedia(url)} alt="" className="w-full h-full object-cover" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Инфо */}
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-[var(--color-text)] leading-tight">{product.title}</h1>

          <div className="flex items-baseline gap-3 mt-3">
            <span className="text-3xl lg:text-4xl font-extrabold text-[#22c55e]">
              {formatPrice(product.price)}
            </span>
          </div>

          {product.seller?.name && (
            <div className="flex items-center gap-2 mt-4 text-sm text-[var(--color-muted)]">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#22c55e] to-[#34d399] flex items-center justify-center text-[#0d1512] font-extrabold text-xs">
                {(product.seller.name || '?')[0].toUpperCase()}
              </div>
              <span>Продавец: <span className="text-[var(--color-text)] font-medium">{product.seller.name}</span></span>
            </div>
          )}

          {/* Количество */}
          <div className="flex items-center gap-4 mt-6">
            <span className="text-sm text-[var(--color-muted)]">Количество:</span>
            <div className="inline-flex items-center gap-2 px-1.5 py-1 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)]">
              <button onClick={() => setQuantity(Math.max(1, quantity - 1))} aria-label="Уменьшить количество" className="w-11 h-11 rounded-lg hover:bg-[var(--bg-3)] flex items-center justify-center text-[var(--color-text)] transition-colors">
                <Minus size={17} />
              </button>
              <span className="w-8 text-center font-bold text-[var(--color-text)]">{quantity}</span>
              <button onClick={() => setQuantity(quantity + 1)} aria-label="Увеличить количество" className="w-11 h-11 rounded-lg hover:bg-[var(--bg-3)] flex items-center justify-center text-[var(--color-text)] transition-colors">
                <Plus size={17} />
              </button>
            </div>
          </div>

          {/* Кнопки */}
          <div className="flex items-stretch gap-2 mt-6">
            <button
              onClick={handleBuy}
              disabled={buying}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-[#22c55e] text-[#0d1512] font-extrabold text-base hover:bg-[#16a34a] transition-colors disabled:opacity-50"
            >
              <ShoppingCart size={17} /> {buying ? 'Оформление...' : 'Купить'}
            </button>
            <button
              onClick={() => addToCart(product)}
              className="shrink-0 w-12 flex items-center justify-center rounded-xl border border-[var(--color-border)] text-[var(--color-text)] hover:border-[#22c55e]/40 hover:bg-[var(--color-surface)] transition-colors"
              title="В корзину"
            >
              <ShoppingCart size={18} />
            </button>
            <button
              onClick={() => { toggleFavorite(product.id); toast.success(isFavorite(product.id) ? 'Убрано из избранного' : 'В избранном'); }}
              className={`shrink-0 w-12 flex items-center justify-center rounded-xl border transition-colors ${isFavorite(product.id) ? 'border-[#22c55e] text-[#22c55e] bg-[#22c55e]/10' : 'border-[var(--color-border)] text-[var(--color-text)] hover:border-[#22c55e]/40 hover:bg-[var(--color-surface)]'}`}
              title="В избранное"
            >
              <Heart size={18} fill={isFavorite(product.id) ? 'currentColor' : 'none'} />
            </button>
            {isAuthenticated && (
              <button
                onClick={() => navigate(`/bazar?productId=${product.id}`)}
                className="shrink-0 flex items-center justify-center gap-1.5 px-3 rounded-xl border border-[#22c55e]/40 text-[#22c55e] hover:bg-[#22c55e]/10 transition-colors"
                title="Купить через Базара"
              >
                <Sparkles size={17} />
                <span className="text-xs font-bold whitespace-nowrap">Купить через Базара</span>
              </button>
            )}
          </div>

          {error && <p className="text-sm text-red-400 mt-3">{error}</p>}
        </div>
      </div>

      {/* Видео товара */}
      {videoEmbed && (
        <div className="mt-8">
          <h2 className="text-lg font-bold text-[var(--color-text)] mb-3">Видео</h2>
          {videoEmbed.type === 'video' ? (
            <div className="rounded-2xl overflow-hidden border border-[var(--color-border)] bg-black">
              <video src={resolveMedia(videoEmbed.src)} controls playsInline className="w-full max-h-[520px]" />
            </div>
          ) : videoEmbed.type === 'iframe' ? (
            <div className="rounded-2xl overflow-hidden border border-[var(--color-border)] aspect-video">
              <iframe
                src={videoEmbed.src}
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                allowFullScreen
                title="Видео товара"
              />
            </div>
          ) : (
            <a
              href={videoEmbed.src}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-3 rounded-xl border border-[#22c55e]/40 text-[#22c55e] hover:bg-[#22c55e]/10 transition-colors text-sm font-bold"
            >
              <Video size={17} /> Открыть видео {videoEmbed.label ? `(${videoEmbed.label})` : ''}
            </a>
          )}
        </div>
      )}

      {/* Оплата QR */}
      {payment?.depositAddress && (
        <div className="mt-6 rounded-2xl bg-[var(--color-surface)] border border-[#22c55e]/20 p-5">
          <p className="text-sm font-bold text-[var(--color-text)] mb-3">Оплата USDT (BSC):</p>
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-white rounded-xl">
              <QRCodeSVG value={payment.depositAddress} size={180} />
            </div>
          </div>
          <code className="block px-3 py-2.5 rounded-lg bg-[var(--bg-3)] border border-[var(--color-border)] text-xs text-[#34d399] break-all font-mono">
            {payment.depositAddress}
          </code>
          <p className="mt-3 text-xs text-[var(--color-muted)]">
            Статус: {payment.status === 'CONFIRMED' || payment.status === 'SWEPT' ? 'Оплачено ✅' : payment.status || 'PENDING'}
          </p>
        </div>
      )}

      {/* Описание — на всю ширину, под контентом */}
      {product.description && (
        <div className="mt-8">
          <h2 className="text-lg font-bold text-[var(--color-text)] mb-3">Описание</h2>
          <p className="text-sm text-[var(--color-muted)] leading-relaxed">{product.description}</p>
        </div>
      )}

      {/* Похожие — горизонтальная карусель со стрелками */}
      {similar.length > 0 && (
        <div className="mt-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-[var(--color-text)]">Похожие товары</h2>
            <div className="flex gap-1.5">
              <button onClick={() => scrollSimilar(-1)} className="w-8 h-8 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)] hover:border-[#22c55e]/40 flex items-center justify-center transition-colors">
                <ChevronLeft size={16} />
              </button>
              <button onClick={() => scrollSimilar(1)} className="w-8 h-8 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)] hover:border-[#22c55e]/40 flex items-center justify-center transition-colors">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
          <div ref={similarRef} className="flex gap-3 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0 no-scrollbar">
            {similar.map((s) => (
              <div
                key={s.id}
                onClick={() => { navigate(`/products/${s.id}`); window.scrollTo({ top: 0 }); }}
                className="shrink-0 w-36 rounded-2xl overflow-hidden cursor-pointer bg-[var(--color-surface)] border border-[var(--color-border)] hover:border-[#22c55e]/40 transition-colors group"
              >
                <div className="aspect-square bg-[var(--bg-3)] overflow-hidden">
                  {s.media?.[0] && <img src={resolveMedia(s.media[0])} alt={s.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />}
                </div>
                <div className="p-2.5">
                  <div className="text-[13px] font-medium text-[var(--color-text)] truncate mb-0.5">{s.title}</div>
                  <div className="text-[13px] font-bold text-[#22c55e]">{formatPrice(s.price)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Модалка фото */}
      <AnimatePresence>
        {selectedImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
            onClick={() => setSelectedImage(null)}
          >
            <motion.button
              whileHover={{ scale: 1.1 }}
              className="absolute top-6 right-6 text-white"
              onClick={() => setSelectedImage(null)}
            >
              <span className="text-3xl">×</span>
            </motion.button>
            <motion.img
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.8 }}
              src={selectedImage}
              className="max-w-full max-h-full rounded-2xl shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}