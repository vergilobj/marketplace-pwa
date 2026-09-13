import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShoppingCart, Minus, Plus, ArrowLeft, ChevronLeft, ChevronRight, Heart,
  Sparkles, Video, PackageX, LayoutGrid, Clock, CheckCircle2, ShieldCheck,
  Loader2, User,
} from 'lucide-react';
import { getProductById, getSimilarProducts } from '../api/products';
import { createOrder, getOrderPaymentStatus } from '../api/orders';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '../hooks/useAuth';
import { useApp } from '../context/AppContext';
import { resolveMedia } from '../utils/media';
import { getVideoEmbed, buildGallery } from '../utils/video';
import { formatPrice } from '../utils/format';
import toast from 'react-hot-toast';
import { errorMessage } from '../utils/error';
import type { ApiProduct } from '../api/types';
import { PageSkeleton } from '../components/ui/Skeleton';

/**
 * A5.2: окно оплаты заказа. Значение совпадает с CheckoutPage и с серверной
 * настройкой order_payment_ttl_minutes — покупатель видит тот же срок, что
 * реально действует на бэкенде.
 */
const PAYMENT_WINDOW_MS = 15 * 60 * 1000;

/** Депозит подтверждён: деньги в эскроу, продавец уведомлён. */
const isPaidStatus = (s?: string | null) => s === 'CONFIRMED' || s === 'SWEPT';

/**
 * A5.2: понятный статус вместо сырого кода транзакции.
 * Раньше в панели оплаты показывалось «PENDING» — владелец справедливо не
 * понимал, оплачено или нет.
 */
function paymentStatusLabel(status?: string | null): string {
  if (isPaidStatus(status)) return 'Оплачено, продавец уведомлён';
  switch (status) {
    case 'FAILED':
      return 'Оплата не прошла';
    case 'UNDERPAID':
      return 'Пришла неполная сумма — доплатите остаток';
    case 'OVERPAID':
      return 'Оплачено (с переплатой)';
    case 'REFUNDED':
      return 'Возврат выполнен';
    default:
      return 'Ожидаем оплату';
  }
}

/** mm:ss для таймера обратного отсчёта. */
function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

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
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [activeImg, setActiveImg] = useState(0);
  const similarRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const total = product ? product.price * quantity : 0;

  /**
   * J1: единая галерея товара — видео первым слайдом, затем фото.
   * До этого видео жило отдельным блоком ПОД галереей, а владелец требует
   * первым слайдом (та же утилита, что в PostDetailPage и карточках каталога).
   *
   * Считаем ДО ранних return'ов (loading / !product) — иначе useMemo
   * вызывался бы не на каждом рендере и порядок хуков поехал бы.
   */
  const gallery = useMemo(
    () => buildGallery(product?.media as string[] | string | null | undefined, product?.videoUrl),
    [product],
  );
  const galleryLen = gallery.length;
  const slideIdx = galleryLen > 0 ? ((activeImg % galleryLen) + galleryLen) % galleryLen : 0;
  const currentSlide = galleryLen > 0 ? gallery[slideIdx] : null;

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

  // Поллинг статуса оплаты и таймер живут ровно столько, сколько открыта
  // панель оплаты. Без очистки интервал продолжал бы стучать в API после
  // ухода со страницы и дёргал бы setState у размонтированного компонента.
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // A5.2: обратный отсчёт на оплату. По истечении счёт закрывается — иначе
  // покупатель платит на адрес, срок жизни которого уже истёк.
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => {
      const left = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setTimeLeft(left);
      if (left <= 0) {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        setPayment(null);
        setExpiresAt(null);
        toast.error('Время оплаты истекло. Оформите заказ заново.');
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  const handleBuy = async () => {
    if (!product || buying) return;
    setBuying(true);
    setError('');
    try {
      const order = await createOrder(product.id, product.price * quantity);
      const pay = order?.payment || {};
      if (pay.depositAddress) {
        setPayment({
          depositAddress: pay.depositAddress,
          status: pay.status || 'PENDING',
          orderId: order.id,
        });
        // A5.2: таймер стартует с момента выпуска счёта.
        setExpiresAt(Date.now() + PAYMENT_WINDOW_MS);

        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(async () => {
          try {
            const st = await getOrderPaymentStatus(order.id);
            setPayment((prev) => (prev ? { ...prev, status: st.status } : prev));
            if (isPaidStatus(st.status)) {
              if (pollRef.current) clearInterval(pollRef.current);
              pollRef.current = null;
              setExpiresAt(null);
              toast.success('Оплата получена! Продавец уведомлён.');
              // Даём прочитать статус «Оплачено, продавец уведомлён»,
              // а не уносим с страницы через мгновение.
              setTimeout(() => navigate(`/orders?highlight=${order.id}`), 3000);
            }
          } catch {
            /* сеть моргнула — продолжаем поллить */
          }
        }, 3000);
      } else {
        navigate(`/orders?highlight=${order.id}`);
      }
    } catch (err: unknown) {
      setError(errorMessage(err, 'Ошибка при создании заказа'));
      toast.error(errorMessage(err, 'Ошибка при создании заказа'));
    } finally {
      setBuying(false);
    }
  };

  const handleAddToCart = () => {
    if (!product) return;
    addToCart(product);
    toast.success(`В корзине: ${product.title}`);
  };

  // PERF-4: был серый квадрат 40×40 на пустом py-32 — заменён на скелетон
  // карточки товара (галерея + заголовок + цена), совпадающий по высоте.
  if (loading) {
    return <PageSkeleton image rows={2} />;
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

  const paid = isPaidStatus(payment?.status);
  const sellerId = product.seller?.id || product.sellerId;

  /**
   * Видео-ССЫЛКА (Яндекс.Диск / Google Диск / Telegram): такие хосты не
   * встраиваются, buildGallery их в слайды не кладёт. Показываем ссылкой,
   * как и раньше — этот путь нельзя потерять.
   */
  const rawEmbed = getVideoEmbed(product.videoUrl);
  const linkEmbed = rawEmbed?.type === 'link' ? rawEmbed : null;

  /**
   * A5.3: блок количества. На мобиле он живёт в нижней панели (там же, где
   * кнопки), на десктопе — в колонке с описанием. Раньше «+ / −» висели
   * отдельно от кнопок и было непонятно, на что они влияют.
   */
  const quantityStepper = (size: 'sm' | 'lg') => (
    <div className="inline-flex items-center gap-1.5 px-1.5 py-1 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)]">
      <button
        type="button"
        onClick={() => setQuantity((q) => Math.max(1, q - 1))}
        disabled={quantity <= 1}
        aria-label="Уменьшить количество"
        title="Уменьшить количество"
        className={`${size === 'lg' ? 'w-11 h-11' : 'w-9 h-9'} rounded-lg hover:bg-[var(--bg-3)] disabled:opacity-35 flex items-center justify-center text-[var(--color-text)] transition-colors`}
      >
        <Minus size={17} />
      </button>
      <span
        className={`text-center font-bold text-[var(--color-text)] ${size === 'lg' ? 'w-9 text-base' : 'w-7 text-sm'}`}
        aria-live="polite"
        aria-label={`Количество: ${quantity}`}
      >
        {quantity}
      </span>
      <button
        type="button"
        onClick={() => setQuantity((q) => q + 1)}
        aria-label="Увеличить количество"
        title="Увеличить количество"
        className={`${size === 'lg' ? 'w-11 h-11' : 'w-9 h-9'} rounded-lg hover:bg-[var(--bg-3)] flex items-center justify-center text-[var(--color-text)] transition-colors`}
      >
        <Plus size={17} />
      </button>
    </div>
  );

  return (
    <div className="relative max-w-5xl mx-auto px-4 sm:px-6 pt-6 pb-72 lg:pb-20 overflow-x-hidden">
      <button onClick={() => navigate(-1)} className="tap-link items-center gap-2 text-[var(--color-muted)] hover:text-[var(--color-text)] mb-6 transition-colors text-sm">
        <ArrowLeft size={16} /> Назад
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        {/* J1: ЕДИНАЯ галерея — видео первым слайдом, затем фото.
            Подход повторяет PostDetailPage: buildGallery(product.media, product.videoUrl).
            Ссылки-видео (Яндекс/Google/Telegram) в слайды не попадают —
            они остаются отдельным блоком ниже, отображение сохранено. */}
        <div>
          <div className="relative rounded-2xl overflow-hidden bg-[var(--color-surface)] border border-[var(--color-border)] aspect-square mb-3">
            {currentSlide?.type === 'video' ? (
              <video
                src={resolveMedia(currentSlide.src)}
                controls
                playsInline
                preload="metadata"
                className="w-full h-full object-cover bg-black"
              />
            ) : currentSlide?.type === 'embed' ? (
              <iframe
                src={currentSlide.src}
                title={currentSlide.label || 'Видео'}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                allowFullScreen
                className="w-full h-full"
              />
            ) : currentSlide ? (
              <img
                src={resolveMedia(currentSlide.src)}
                alt={product.title}
                width={1000}
                height={1000}
                loading={slideIdx === 0 ? 'eager' : 'lazy'}
                decoding="async"
                className="w-full h-full object-cover cursor-zoom-in"
                onClick={() => setSelectedImage(resolveMedia(currentSlide.src))}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[var(--color-faint)]">
                <ShoppingCart size={40} />
              </div>
            )}

            {gallery.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => setActiveImg((slideIdx - 1 + gallery.length) % gallery.length)}
                  aria-label="Предыдущий слайд"
                  className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/55 backdrop-blur text-white flex items-center justify-center hover:bg-black/75 transition-colors"
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => setActiveImg((slideIdx + 1) % gallery.length)}
                  aria-label="Следующий слайд"
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/55 backdrop-blur text-white flex items-center justify-center hover:bg-black/75 transition-colors"
                >
                  <ChevronRight size={18} />
                </button>
                <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
                  {gallery.map((_, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setActiveImg(i)}
                      aria-label={`Показать слайд ${i + 1}`}
                      /* MED-1: точки были 6×6/16×6 — попасть пальцем нельзя.
                         Хит-зона расширена до 44px по высоте и ~12px по ширине
                         через padding; визуальная точка остаётся 6px (span внутри). */
                      className="py-3 px-1.5 flex items-center"
                    >
                      <span className={`block h-1.5 rounded-full transition-all duration-200 ${i === slideIdx ? 'w-4 bg-white' : 'w-1.5 bg-white/50'}`} />
                    </button>
                  ))}
                  {currentSlide?.type === 'video' && (
                    <span className="ml-1 text-[10px] font-bold uppercase text-white/80">видео</span>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Таумбнейлы: видео-слайд первым, фото после */}
          {gallery.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {gallery.map((slide, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setActiveImg(idx)}
                  aria-label={
                    slide.type === 'image'
                      ? `Фото ${gallery.slice(0, idx + 1).filter((s) => s.type === 'image').length}`
                      : 'Видео'
                  }
                  className={`relative shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition-colors ${
                    idx === slideIdx ? 'border-[#22c55e]' : 'border-[var(--color-border)] hover:border-[#22c55e]/40'
                  }`}
                >
                  {slide.type === 'image' ? (
                    <img src={resolveMedia(slide.src)} alt="" width={64} height={64} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                  ) : (
                    <div className="w-full h-full bg-black flex items-center justify-center text-white">
                      <Video size={18} />
                    </div>
                  )}
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
            <span className="text-xs text-[var(--color-muted)]">за 1 шт</span>
          </div>

          {/* A5.8: продавец ведёт на публичный профиль */}
          {sellerId && (
            <button
              type="button"
              onClick={() => navigate(`/users/${sellerId}`)}
              className="inline-flex items-center gap-2 mt-4 text-sm text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors group"
            >
              <span className="w-7 h-7 rounded-full bg-gradient-to-br from-[#22c55e] to-[#34d399] flex items-center justify-center text-[#0d1512] font-extrabold text-xs">
                {(product.seller?.name || '?')[0].toUpperCase()}
              </span>
              <span>
                Продавец:{' '}
                <span className="text-[var(--color-text)] font-medium underline underline-offset-2 decoration-[var(--color-border)] group-hover:decoration-[#22c55e]">
                  {product.seller?.name || 'Профиль'}
                </span>
              </span>
              <User size={13} className="opacity-60" />
            </button>
          )}

          {/* A5.3: количество + итог — только десктоп (на мобиле в нижней панели) */}
          <div className="hidden lg:block mt-6">
            <div className="flex items-center gap-4">
              <span className="text-sm text-[var(--color-muted)]">Количество:</span>
              {quantityStepper('lg')}
            </div>
            <div className="mt-3 flex items-baseline gap-2 text-sm">
              <span className="text-[var(--color-muted)]">
                {formatPrice(product.price)} × {quantity} шт =
              </span>
              <span className="text-xl font-extrabold text-[#22c55e]">{formatPrice(total)}</span>
            </div>
          </div>

          {/* Кнопки — десктоп */}
          <div className="hidden lg:flex flex-wrap items-stretch gap-2 mt-6">
            <button
              onClick={handleBuy}
              disabled={buying || !!payment}
              className="flex-1 min-w-[160px] flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-[#22c55e] text-[#0d1512] font-extrabold text-base hover:bg-[#16a34a] transition-colors disabled:opacity-50"
            >
              {buying ? <Loader2 size={17} className="animate-spin" /> : <ShoppingCart size={17} />}
              {buying ? 'Оформление...' : payment ? 'Счёт выставлен' : 'Купить'}
            </button>
            <button
              onClick={handleAddToCart}
              className="flex-1 min-w-[140px] flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl border border-[var(--color-border)] text-[var(--color-text)] font-bold text-sm hover:border-[#22c55e]/40 hover:bg-[var(--color-surface)] transition-colors"
            >
              <ShoppingCart size={17} /> В корзину
            </button>
            <button
              onClick={() => { toggleFavorite(product.id); toast.success(isFavorite(product.id) ? 'Убрано из избранного' : 'В избранном'); }}
              aria-label="В избранное"
              className={`shrink-0 w-12 flex items-center justify-center rounded-xl border transition-colors ${isFavorite(product.id) ? 'border-[#22c55e] text-[#22c55e] bg-[#22c55e]/10' : 'border-[var(--color-border)] text-[var(--color-text)] hover:border-[#22c55e]/40 hover:bg-[var(--color-surface)]'}`}
            >
              <Heart size={18} fill={isFavorite(product.id) ? 'currentColor' : 'none'} />
            </button>
          </div>

          {isAuthenticated && (
            <button
              onClick={() => navigate(`/bazar?productId=${product.id}`)}
              className="hidden lg:flex w-full mt-2 items-center justify-center gap-2 px-4 py-3 rounded-xl border border-[#22c55e]/40 text-[#22c55e] hover:bg-[#22c55e]/10 transition-colors text-sm font-bold"
            >
              <Sparkles size={16} /> Купить через Базара
            </button>
          )}

          {error && <p className="text-sm text-red-400 mt-3">{error}</p>}
        </div>
      </div>

      {/* Видео-ССЫЛКА (Яндекс.Диск / Google Диск / Telegram).
          Файловые видео и embed-хостинги теперь живут первым слайдом галереи,
          а сюда попадают только ссылки: buildGallery их не берёт, а показать
          их покупателю нужно — этот путь сохранён. */}
      {linkEmbed && (
        <div className="mt-8">
          <h2 className="text-lg font-bold text-[var(--color-text)] mb-3">Видео</h2>
          <a
            href={linkEmbed.src}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-3 rounded-xl border border-[#22c55e]/40 text-[#22c55e] hover:bg-[#22c55e]/10 transition-colors text-sm font-bold"
          >
            <Video size={17} /> Открыть видео {linkEmbed.label ? `(${linkEmbed.label})` : ''}
          </a>
        </div>
      )}

      {/* A5.2: оплата — QR, таймер, понятный статус и объяснение эскроу */}
      {payment?.depositAddress && (
        <div className="mt-6 rounded-2xl bg-[var(--color-surface)] border border-[#22c55e]/20 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <p className="text-sm font-bold text-[var(--color-text)]">Оплата USDT (BSC)</p>
            {paid ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#22c55e]">
                <CheckCircle2 size={14} /> Оплачено
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#22c55e] bg-[#22c55e]/10 px-2.5 py-1 rounded-full">
                <Clock size={13} /> Осталось {formatCountdown(timeLeft)}
              </span>
            )}
          </div>

          <div className="flex justify-center mb-4">
            <div className="p-3 bg-white rounded-xl">
              <QRCodeSVG value={payment.depositAddress} size={180} />
            </div>
          </div>

          <code className="block px-3 py-2.5 rounded-lg bg-[var(--bg-3)] border border-[var(--color-border)] text-xs text-[#34d399] break-all font-mono">
            {payment.depositAddress}
          </code>

          {/* Понятный статус вместо сырого PENDING/CONFIRMED */}
          <div className="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--bg-3)] p-3.5">
            <p className={`text-sm font-bold ${paid ? 'text-[#22c55e]' : 'text-[var(--color-text)]'}`}>
              {paymentStatusLabel(payment.status)}
            </p>
            <ol className="mt-3 space-y-2">
              {[
                { label: 'Ожидаем оплату', done: true },
                { label: 'Оплачено, продавец уведомлён', done: paid },
                { label: 'Продавец собирает заказ', done: paid },
              ].map((step) => (
                <li key={step.label} className="flex items-center gap-2 text-xs">
                  {step.done ? (
                    <CheckCircle2 size={14} className="text-[#22c55e] shrink-0" />
                  ) : (
                    <Clock size={14} className="text-[var(--color-faint)] shrink-0" />
                  )}
                  <span className={step.done ? 'text-[var(--color-text)]' : 'text-[var(--color-muted)]'}>
                    {step.label}
                  </span>
                </li>
              ))}
            </ol>
          </div>

          {/* Что вообще происходит с деньгами */}
          <div className="mt-3 flex items-start gap-2 text-xs text-[var(--color-muted)] leading-relaxed">
            <ShieldCheck size={15} className="text-[#22c55e] shrink-0 mt-0.5" />
            <span>
              Деньги замораживаются в эскроу и уходят продавцу только после того, как вы
              подтвердите получение заказа. Как только оплата дойдёт, продавец получит
              уведомление и начнёт сборку заказа.
            </span>
          </div>

          {!paid && timeLeft === 0 && (
            <p className="mt-3 text-xs text-red-400">
              Счёт истёк. Нажмите «Купить», чтобы выставить новый.
            </p>
          )}
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
              <button onClick={() => scrollSimilar(-1)} aria-label="Прокрутить влево" className="w-8 h-8 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)] hover:border-[#22c55e]/40 flex items-center justify-center transition-colors">
                <ChevronLeft size={16} />
              </button>
              <button onClick={() => scrollSimilar(1)} aria-label="Прокрутить вправо" className="w-8 h-8 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)] hover:border-[#22c55e]/40 flex items-center justify-center transition-colors">
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
                  {s.media?.[0] && <img src={resolveMedia(s.media[0])} alt={s.title} width={144} height={144} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" decoding="async" />}
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

      {/* A5.1: нижняя панель действий на мобиле.
          Раньше кнопки стояли в общем flex-ряду с nowrap-подписью
          «Купить через Базара» и вылезали за 390px. Теперь на мобиле все
          действия закреплены внизу и укладываются в ширину экрана, а на
          десктопе остаются в колонке с описанием.

          V1 (VISUAL-PROD фикс 1): панель стояла на `bottom-0` с тем же
          z-index 40, что и таб-бар навигации. Таб-бар идёт позже в DOM →
          при равном z-index он выигрывал хит-тест и перехватывал 419 из 420
          точек кнопки «Купить через Базара» (clickablePct: 0). Поднимаем
          панель НАД таб-баром (bottom-3 + ~62px высоты → 76px), а не
          z-index'ом: z-index спрятал бы таб-бар под панелью и лишил
          покупателя навигации на странице товара. */}
      <div
        className="lg:hidden fixed bottom-[76px] inset-x-0 z-40 border-t border-[var(--color-border)] bg-[var(--color-bg)]/95 backdrop-blur px-3 pt-2.5"
        style={{ paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom))' }}
      >
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--color-muted)]">Кол-во:</span>
            {quantityStepper('sm')}
          </div>
          <div className="text-right leading-tight">
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">Итого</div>
            <div className="text-base font-extrabold text-[#22c55e] whitespace-nowrap">{formatPrice(total)}</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleBuy}
            disabled={buying || !!payment}
            className="flex-1 min-h-[48px] flex items-center justify-center gap-2 px-3 rounded-xl bg-[#22c55e] text-[#0d1512] font-extrabold text-sm hover:bg-[#16a34a] transition-colors disabled:opacity-50"
          >
            {buying ? <Loader2 size={16} className="animate-spin" /> : <ShoppingCart size={16} />}
            {buying ? 'Оформление...' : payment ? 'Счёт выставлен' : 'Купить'}
          </button>
          <button
            onClick={handleAddToCart}
            className="flex-1 min-h-[48px] flex items-center justify-center gap-2 px-3 rounded-xl border border-[var(--color-border)] text-[var(--color-text)] font-bold text-sm hover:border-[#22c55e]/40 transition-colors"
          >
            <ShoppingCart size={16} /> В корзину
          </button>
          <button
            onClick={() => { toggleFavorite(product.id); toast.success(isFavorite(product.id) ? 'Убрано из избранного' : 'В избранном'); }}
            aria-label="В избранное"
            className={`shrink-0 w-12 min-h-[48px] flex items-center justify-center rounded-xl border transition-colors ${isFavorite(product.id) ? 'border-[#22c55e] text-[#22c55e] bg-[#22c55e]/10' : 'border-[var(--color-border)] text-[var(--color-text)]'}`}
          >
            <Heart size={17} fill={isFavorite(product.id) ? 'currentColor' : 'none'} />
          </button>
        </div>

        {isAuthenticated && (
          <button
            onClick={() => navigate(`/bazar?productId=${product.id}`)}
            className="mt-2 w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl border border-[#22c55e]/40 text-[#22c55e] text-sm font-bold"
          >
            <Sparkles size={15} /> Купить через Базара
          </button>
        )}
      </div>

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
              aria-label="Закрыть"
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