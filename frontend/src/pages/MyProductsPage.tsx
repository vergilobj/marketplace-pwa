import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Package, Edit3, Eye, EyeOff, Trash2, Plus } from 'lucide-react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import Skeleton from '../components/ui/Skeleton';
import api from '../api/axios';
import toast from 'react-hot-toast';

export default function MyProductsPage() {
  const navigate = useNavigate();
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadProducts = () => {
    setLoading(true);
    api.get('/products/my')
      .then(res => setProducts(res.data))
      .catch(() => toast.error('Не удалось загрузить товары'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadProducts(); }, []);

  const toggleActive = async (product: any) => {
    try {
      await api.patch(`/products/${product.id}`, { isActive: !product.isActive });
      setProducts(prev =>
        prev.map(p => p.id === product.id ? { ...p, isActive: !p.isActive } : p)
      );
      toast.success(product.isActive ? 'Товар скрыт' : 'Товар опубликован');
    } catch (err) {
      toast.error('Ошибка');
    }
  };

  const deleteProduct = async (id: string) => {
    if (!confirm('Удалить товар?')) return;
    try {
      await api.delete(`/products/${id}`);
      setProducts(prev => prev.filter(p => p.id !== id));
      toast.success('Товар удалён');
    } catch (err) {
      toast.error('Не удалось удалить');
    }
  };

  const container = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.05 } },
  };
  const item = {
    hidden: { opacity: 0, y: 10 },
    show: { opacity: 1, y: 0 },
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Мои товары</h1>
        <Button variant="primary" onClick={() => navigate('/products/new')}>
          <Plus size={18} className="mr-1" /> Создать
        </Button>
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-24 rounded-3xl" />
          <Skeleton className="h-24 rounded-3xl" />
          <Skeleton className="h-24 rounded-3xl" />
        </div>
      ) : products.length === 0 ? (
        <EmptyState message="У вас пока нет товаров" />
      ) : (
        <motion.div variants={container} initial="hidden" animate="show" className="space-y-4">
          {products.map(product => (
            <motion.div key={product.id} variants={item}>
              <Card className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-xl bg-gray-100 dark:bg-gray-800 overflow-hidden">
                    <img
                      src={product.media?.[0] || '/placeholder.jpg'}
                      alt={product.title}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div>
                    <h3 className="font-semibold">{product.title}</h3>
                    <p className="text-sm text-gray-500">{product.price.toLocaleString()} ₽</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${product.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {product.isActive ? 'Активен' : 'Скрыт'}
                    </span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate(`/products/${product.id}/edit`)}
                  >
                    <Edit3 size={16} className="mr-1" /> Ред.
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleActive(product)}
                  >
                    {product.isActive ? <EyeOff size={16} /> : <Eye size={16} />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-500"
                    onClick={() => deleteProduct(product.id)}
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  );
}