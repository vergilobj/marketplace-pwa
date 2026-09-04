import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ShoppingCart, MessageCircle, Minus, Plus, Truck, ShieldCheck, RotateCcw } from 'lucide-react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { getProductById, getSimilarProducts } from '../api/products';
import { createOrder, getOrderPaymentStatus } from '../api/orders';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '../hooks/useAuth';
import Breadcrumbs from '../components/Breadcrumbs';
import Skeleton from '../components/ui/Skeleton';

const GS = { background: 'linear-gradient(135deg, #6366f1 0%, #38bdf8 50%, #38bdf8 100%)' } as const;

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [product, setProduct] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState(false);
  const [error, setError] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [similar, setSimilar] = useState<any[]>([]);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [payment, setPayment] = useState<{ depositAddress?: string; status?: string; orderId?: string } | null>(null);

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
      // Показываем карточку оплаты с QR прямо на странице товара.
      const pay = order?.payment || {};
      if (pay.depositAddress) {
        setPayment({ depositAddress: pay.depositAddress, status: pay.status || 'PENDING', orderId: order.id });
        // Поллинг статуса до подтверждения.
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
    } catch (err: any) {
      setError(err.response?.data?.message || 'Ошибка при создании заказа');
    } finally {
      setBuying(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto space-y-8">
        <Skeleton className="h-6 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <Skeleton className="h-96 rounded-[34px]" />
          <div className="space-y-4">
            <Skeleton className="h-10 w-3/4" />
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-12 w-40" />
          </div>
        </div>
      </div>
    );
  }

  if (error && !product) return <p className="text-center py-10 text-red-500">{error}</p>;

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <Breadcrumbs items={[{ label: 'Главная', to: '/' }, { label: product.title }]} />

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Галерея */}
          <div className="space-y-4">
            <motion.div
              className="rounded-[34px] overflow-hidden bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.07)] relative group"
              whileHover={{ scale: 1.02 }}
            >
              <motion.img
                src={product.media?.[0] || '/placeholder.jpg'}
                alt={product.title}
                className="w-full h-96 object-cover cursor-pointer"
                onClick={() => setSelectedImage(product.media?.[0] || '/placeholder.jpg')}
              />
              {product.media?.length > 1 && (
                <div className="absolute bottom-4 left-4 right-4 flex gap-2 overflow-x-auto">
                  {product.media.map((url: string, idx: number) => (
                    <motion.img
                      key={idx}
                      src={url}
                      whileHover={{ scale: 1.1 }}
                      className="w-16 h-16 rounded-xl object-cover border-2 border-white/80 cursor-pointer opacity-80 hover:opacity-100 transition"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedImage(url);
                      }}
                    />
                  ))}
                </div>
              )}
            </motion.div>
          </div>

          {/* Информация */}
          <div className="space-y-6">
            <div>
              <h1 className="text-4xl font-bold tracking-tight">{product.title}</h1>
              <p className="text-2xl font-bold mt-2 text-gradient">{product.price.toLocaleString()} USDT</p>
              {quantity > 1 && (
                <p className="text-sm text-[var(--color-muted)] mt-1">
                  {product.price.toLocaleString()} USDT × {quantity} шт. = {(product.price * quantity).toLocaleString()} USDT
                </p>
              )}
            </div>

            <p className="text-[var(--color-muted)] leading-relaxed">{product.description}</p>

            {/* Выбор количества */}
            <div className="flex items-center gap-4 p-3 glass rounded-2xl">
              <span className="text-sm font-medium text-[var(--color-muted)]">Количество:</span>
              <div className="flex items-center gap-2">
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="p-2 rounded-full bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.08)] text-[var(--color-text)] shadow"
                >
                  <Minus size={16} />
                </motion.button>
                <span className="w-8 text-center font-bold">{quantity}</span>
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setQuantity(quantity + 1)}
                  className="p-2 rounded-full bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.08)] text-[var(--color-text)] shadow"
                >
                  <Plus size={16} />
                </motion.button>
              </div>
            </div>

            {/* Кнопки действий */}
            <div className="flex gap-3">
              <motion.div whileTap={{ scale: 0.97 }}>
                <Button
                  variant="primary"
                  onClick={handleBuy}
                  loading={buying}
                  className="px-8 py-4 text-lg rounded-full"
                >
                  <ShoppingCart size={22} className="mr-2" /> Купить сейчас
                </Button>
              </motion.div>
              {isAuthenticated && (
                <motion.div whileTap={{ scale: 0.97 }}>
                  <Button
                    variant="secondary"
                    onClick={() => navigate(`/chat?uid=${product.sellerId}&product=${product.id}`)}
                    className="px-6 py-4 rounded-full"
                  >
                    <MessageCircle size={20} className="mr-2" /> Задать вопрос
                  </Button>
                </motion.div>
              )}
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            {/* Карточка оплаты USDT с QR */}
            {payment?.depositAddress && (
              <div className="mt-4 glass border border-emerald-500/20 rounded-2xl p-5">
                <p className="text-sm font-bold text-[var(--color-text)] mb-3">Оплатите USDT (BSC) на адрес:</p>
                <div className="flex justify-center mb-4">
                  <div className="p-3 bg-white rounded-xl">
                    <QRCodeSVG value={payment.depositAddress} size={180} />
                  </div>
                </div>
                <code className="block px-3 py-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-xs text-emerald-300 break-all font-mono">
                  {payment.depositAddress}
                </code>
                <p className="mt-3 text-xs text-white/50">
                  Статус: {payment.status === 'CONFIRMED' || payment.status === 'SWEPT' ? 'Оплачено ✅' : payment.status || 'PENDING'}
                </p>
              </div>
            )}

            {/* Продавец */}
            <div className="flex items-center gap-3 text-sm text-[var(--color-muted)]">
              <div style={GS} className="w-8 h-8 rounded-full flex items-center justify-center text-[var(--color-text)] font-bold">
                {product.seller?.name?.[0] || '?'}
              </div>
              <span>Продавец: <span className="font-medium text-[var(--color-text)]">{product.seller?.name || 'Неизвестный'}</span></span>
            </div>

            {/* Преимущества */}
            <div className="grid grid-cols-3 gap-2 text-center text-sm mt-4">
              <div className="flex flex-col items-center gap-1 p-3 glass rounded-2xl">
                <Truck size={20} className="text-emerald-400" />
                <span className="text-[var(--color-muted)]">Быстрая доставка</span>
              </div>
              <div className="flex flex-col items-center gap-1 p-3 glass rounded-2xl">
                <ShieldCheck size={20} className="text-[#38bdf8]" />
                <span className="text-[var(--color-muted)]">Гарантия возврата</span>
              </div>
              <div className="flex flex-col items-center gap-1 p-3 glass rounded-2xl">
                <RotateCcw size={20} className="text-[#38bdf8]" />
                <span className="text-[var(--color-muted)]">14 дней на обмен</span>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Похожие товары */}
      {similar.length > 0 && (
        <section>
          <h2 className="text-2xl font-bold mb-4">Похожие товары</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {similar.map((s: any) => (
              <motion.div
                key={s.id}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4 }}
                className="cursor-pointer"
                onClick={() => navigate(`/products/${s.id}`)}
              >
                <Card className="hover:shadow-xl transition-shadow p-4">
                  <img
                    src={s.media?.[0] || '/placeholder.jpg'}
                    alt={s.title}
                    className="w-full h-40 object-cover rounded-2xl"
                  />
                  <div className="p-3 space-y-1">
                    <h3 className="font-semibold truncate">{s.title}</h3>
                    <p className="text-lg font-bold text-gradient">{s.price.toLocaleString()} USDT</p>
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>
        </section>
      )}

      {/* Модальное окно для просмотра фото */}
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