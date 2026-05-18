import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, ShoppingCart, MessageCircle } from 'lucide-react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { getProductById } from '../api/products';
import { createOrder } from '../api/orders';

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [product, setProduct] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (id) {
      getProductById(id)
        .then(setProduct)
        .catch(() => setError('Товар не найден'))
        .finally(() => setLoading(false));
    }
  }, [id]);

  const handleBuy = async () => {
    if (!product) return;
    setBuying(true);
    try {
      const order = await createOrder(product.id, product.price);
      navigate(`/orders?highlight=${order.id}`);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Ошибка при создании заказа');
    } finally {
      setBuying(false);
    }
  };

  if (loading) return <p className="text-center text-gray-500">Загрузка...</p>;
  if (error && !product) return <p className="text-center text-red-500">{error}</p>;

  return (
    <div className="max-w-2xl mx-auto">
      <Link to="/" className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-6">
        <ArrowLeft size={16} className="mr-1" /> На главную
      </Link>
      <Card>
        <div className="space-y-6">
          <h1 className="text-3xl font-bold">{product.title}</h1>
          <p className="text-gray-600 dark:text-gray-300">{product.description}</p>
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate(`/chat?uid=${product.sellerId}`)}
            >
              <MessageCircle size={16} className="mr-1" /> Написать продавцу
            </Button>
            <Button variant="primary" onClick={handleBuy} loading={buying} className="px-8">
              <ShoppingCart size={18} className="mr-2" /> Купить
            </Button>
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="text-sm text-gray-400">
            Продавец: {product.seller?.name || 'Неизвестный'}
          </div>
        </div>
      </Card>
    </div>
  );
}