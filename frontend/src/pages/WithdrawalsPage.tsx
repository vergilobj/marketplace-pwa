import React, { useEffect, useState } from 'react';
import api from '../api/axios';
import Card from '../components/ui/Card';
import EmptyState from '../components/ui/EmptyState';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

const statusMap: Record<string, string> = {
  pending: 'На рассмотрении',
  approved: 'Одобрена',
  rejected: 'Отклонена',
};

const statusColor = (s: string) => {
  switch (s) {
    case 'approved': return 'bg-green-100 text-green-700';
    case 'rejected': return 'bg-red-100 text-red-700';
    default: return 'bg-yellow-100 text-yellow-700';
  }
};

export default function WithdrawalsPage() {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/users/me/withdrawals')
      .then(r => setRequests(r.data))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-center py-10 text-gray-500">Загрузка...</p>;

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold">Заявки на вывод</h1>
      {requests.length === 0 ? (
        <EmptyState message="Нет заявок на вывод" />
      ) : (
        <div className="space-y-3">
          {requests.map(r => (
            <Card key={r.id} className="flex items-center justify-between">
              <div>
                <p className="font-semibold">{r.amount.toLocaleString()} ₽</p>
                <p className="text-xs text-gray-500">
                  {format(new Date(r.createdAt), 'dd MMM yyyy HH:mm', { locale: ru })}
                </p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full ${statusColor(r.status)}`}>
                {statusMap[r.status] || r.status}
              </span>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}