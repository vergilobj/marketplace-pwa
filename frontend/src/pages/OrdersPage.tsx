import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { PackageCheck, Gift, TrendingUp, MessageCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import api from '../api/axios';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import Skeleton from '../components/ui/Skeleton';

const statusList = [
  { value: '', label: 'Все' },
  { value: 'PENDING', label: 'Ожидают' },
  { value: 'PAID', label: 'Оплачены' },
  { value: 'SHIPPED', label: 'Отправлены' },
  { value: 'COMPLETED', label: 'Завершены' },
  { value: 'CANCELLED', label: 'Отменены' },
];

const statusMap: Record<string, string> = {
  PENDING: 'Ожидает',
  PAID: 'Оплачен',
  SHIPPED: 'Отправлен',
  COMPLETED: 'Завершён',
  CANCELLED: 'Отменён',
};

const statusColor = (s: string) => {
  switch (s) {
    case 'PAID': return 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300';
    case 'SHIPPED': return 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300';
    case 'COMPLETED': return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300';
    case 'CANCELLED': return 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300';
    default: return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300';
  }
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [searchParams] = useSearchParams();
  const highlightId = searchParams.get('highlight');
  const navigate = useNavigate();

  useEffect(() => {
    setLoading(true);
    const params = statusFilter ? `?status=${statusFilter}` : '';
    api.get(`/orders/my${params}`)
      .then(res => setOrders(res.data))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Мои заказы</h1>

      {/* Фильтр по статусу */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {statusList.map(opt => (
          <motion.button
            key={opt.value}
            whileTap={{ scale: 0.95 }}
            onClick={() => setStatusFilter(opt.value)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition whitespace-nowrap ${
              statusFilter === opt.value
                ? 'bg-blue-600 text-white shadow'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            {opt.label}
          </motion.button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-24 rounded-3xl" />
          <Skeleton className="h-24 rounded-3xl" />
          <Skeleton className="h-24 rounded-3xl" />
        </div>
      ) : orders.length === 0 ? (
        <EmptyState message="Заказов не найдено" />
      ) : (
        <div className="space-y-4">
          {orders.map((o: any) => (
            <Card key={o.id} className={`relative transition-all ${highlightId === o.id ? 'ring-2 ring-blue-500 shadow-xl' : ''}`}>
              <div className="flex items-start justify-between">
                <div className="space-y-2">
                  <h3 className="font-semibold text-lg">{o.product?.title || 'Товар'}</h3>
                  <p className="text-gray-500 text-sm">Сумма: {o.amount.toLocaleString()} ₽</p>
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(o.status)}`}>
                    {statusMap[o.status] || o.status}
                  </span>
                  {o.referralBonus > 0 && (
                    <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 mt-2">
                      <Gift size={14} />
                      <span>Реферальный бонус: {o.referralBonus.toLocaleString()} ₽</span>
                    </div>
                  )}
                  {o.platformFee > 0 && (
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <TrendingUp size={14} />
                      <span>Комиссия платформы: {o.platformFee.toLocaleString()} ₽</span>
                    </div>
                  )}

                  {/* Кнопки чата */}
                  <div className="flex gap-2 mt-2">
                    {o.buyer?.id && (
                      <button
                        onClick={() => navigate(`/chat?uid=${o.buyer.id}`)}
                        className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
                      >
                        <MessageCircle size={14} /> Написать покупателю
                      </button>
                    )}
                    {o.seller?.id && (
                      <button
                        onClick={() => navigate(`/chat?uid=${o.seller.id}`)}
                        className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
                      >
                        <MessageCircle size={14} /> Написать продавцу
                      </button>
                    )}
                  </div>
                </div>
                <PackageCheck className="w-6 h-6 text-gray-300" />
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}