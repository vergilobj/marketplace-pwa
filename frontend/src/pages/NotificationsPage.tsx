import React, { useEffect, useState } from 'react';
import api from '../api/axios';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import Skeleton from '../components/ui/Skeleton';
import { Bell, ShoppingCart, Heart, MessageCircle, CheckCircle } from 'lucide-react';
import { format, isToday, isYesterday, isThisWeek } from 'date-fns';
import { ru } from 'date-fns/locale';
import { motion, AnimatePresence } from 'framer-motion';

const iconMap: Record<string, React.ComponentType<any>> = {
  order: ShoppingCart,
  like: Heart,
  comment: MessageCircle,
};

const typeOptions = [
  { value: 'all', label: 'Все' },
  { value: 'order', label: 'Заказы' },
  { value: 'like', label: 'Лайки' },
  { value: 'comment', label: 'Комментарии' },
];

function groupNotifications(notifications: any[]) {
  const groups: { title: string; items: any[] }[] = [];
  let lastDate: string | null = null;
  for (const n of notifications) {
    const date = new Date(n.createdAt);
    let title: string;
    if (isToday(date)) title = 'Сегодня';
    else if (isYesterday(date)) title = 'Вчера';
    else if (isThisWeek(date, { weekStartsOn: 1 })) title = 'На этой неделе';
    else title = 'Ранее';

    if (lastDate !== title) {
      groups.push({ title, items: [] });
      lastDate = title;
    }
    groups[groups.length - 1].items.push(n);
  }
  return groups;
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    api.get('/notifications')
      .then(r => setNotifications(r.data))
      .finally(() => setLoading(false));
  }, []);

  const markAsRead = async (id: string) => {
    await api.patch(`/notifications/${id}/read`);
    setNotifications(prev =>
      prev.map(n => n.id === id ? { ...n, isRead: true } : n)
    );
  };

  const markAllAsRead = async () => {
    await api.patch('/notifications/read-all');
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
  };

  const filtered = filter === 'all'
    ? notifications
    : notifications.filter(n => n.type === filter);

  const grouped = groupNotifications(filtered);

  const hasUnread = notifications.some(n => !n.isRead);

  if (loading) {
    return (
      <div className="max-w-xl mx-auto space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-20 w-full rounded-3xl" />
        <Skeleton className="h-20 w-full rounded-3xl" />
        <Skeleton className="h-20 w-full rounded-3xl" />
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Уведомления</h1>
        {hasUnread && (
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={markAllAsRead}
            className="text-sm text-blue-600 flex items-center gap-1 hover:underline"
          >
            <CheckCircle size={16} />
            Прочитать все
          </motion.button>
        )}
      </div>

      {/* Фильтр по типу */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {typeOptions.map(opt => (
          <motion.button
            key={opt.value}
            whileTap={{ scale: 0.95 }}
            onClick={() => setFilter(opt.value)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${
              filter === opt.value
                ? 'bg-blue-600 text-white shadow'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            {opt.label}
          </motion.button>
        ))}
      </div>

      {grouped.length === 0 && (
        <EmptyState message="Нет уведомлений" />
      )}

      <AnimatePresence>
        {grouped.map((group, groupIndex) => (
          <motion.div
            key={group.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: groupIndex * 0.05 }}
            className="space-y-3"
          >
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
              {group.title}
            </h3>
            {group.items.map((n, idx) => {
              const Icon = iconMap[n.type] || Bell;
              const date = new Date(n.createdAt);
              const timeStr = format(date, 'HH:mm');
              return (
                <motion.div
                  key={n.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.03 }}
                  layout
                >
                  <Card
                    className={`flex items-start gap-4 cursor-pointer transition-all hover:shadow-md ${
                      !n.isRead
                        ? 'bg-blue-50 dark:bg-blue-900/20 border-l-4 border-l-blue-600'
                        : ''
                    }`}
                    onClick={() => !n.isRead && markAsRead(n.id)}
                  >
                    <div className="p-2 bg-gray-100 dark:bg-gray-800 rounded-full mt-1">
                      <Icon size={18} className={n.isRead ? 'text-gray-400' : 'text-blue-600'} />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{n.message}</p>
                      <p className="text-xs text-gray-400 mt-1">{timeStr}</p>
                    </div>
                    {!n.isRead && (
                      <div className="w-2 h-2 bg-blue-600 rounded-full mt-2" />
                    )}
                  </Card>
                </motion.div>
              );
            })}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}