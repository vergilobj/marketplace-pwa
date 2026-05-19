import React, { useEffect, useState } from 'react';
import api from '../api/axios';
import Card from '../components/ui/Card';
import { Bell, ShoppingCart, Heart, MessageCircle } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

const iconMap: Record<string, any> = {
  order: ShoppingCart,
  like: Heart,
  comment: MessageCircle,
};

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/notifications')
      .then(r => setNotifications(r.data))
      .finally(() => setLoading(false));
  }, []);

  const markAsRead = async (id: string) => {
    await api.patch(`/notifications/${id}/read`);
    setNotifications(prev =>
      prev.map(n => (n.id === id ? { ...n, isRead: true } : n))
    );
  };

  if (loading) return <p className="text-center py-10 text-gray-500">Загрузка...</p>;

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold">Уведомления</h1>
      <div className="space-y-3">
        {notifications.map(n => {
          const Icon = iconMap[n.type] || Bell;
          return (
            <Card
              key={n.id}
              className={`flex items-start gap-4 cursor-pointer ${
                !n.isRead ? 'bg-blue-50 dark:bg-blue-900/20' : ''
              }`}
              onClick={() => !n.isRead && markAsRead(n.id)}
            >
              <div className="p-2 bg-gray-100 dark:bg-gray-800 rounded-full">
                <Icon size={18} />
              </div>
              <div className="flex-1">
                <p className="text-sm">{n.message}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {format(new Date(n.createdAt), 'dd MMM HH:mm', { locale: ru })}
                </p>
              </div>
              {!n.isRead && <div className="w-2 h-2 bg-blue-600 rounded-full mt-2" />}
            </Card>
          );
        })}
        {notifications.length === 0 && (
          <p className="text-center text-gray-500">Пока нет уведомлений</p>
        )}
      </div>
    </div>
  );
}