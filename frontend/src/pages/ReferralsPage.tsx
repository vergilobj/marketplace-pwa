import React, { useEffect, useState } from 'react';
import api from '../api/axios';
import Card from '../components/ui/Card';
import { Gift, TrendingUp } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

export default function ReferralsPage() {
  const [referrals, setReferrals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/users/me/referrals')
      .then(r => setReferrals(r.data))
      .finally(() => setLoading(false));
  }, []);

  const totalBonus = referrals.reduce((sum, r) => sum + r.referralBonus, 0);

  if (loading) return <p className="text-center py-10 text-gray-500">Загрузка...</p>;

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold">Реферальная история</h1>
      <Card>
        <div className="flex items-center justify-between">
          <span className="text-gray-500">Всего заработано бонусов:</span>
          <span className="text-xl font-bold text-green-600">{totalBonus.toLocaleString()} ₽</span>
        </div>
      </Card>
      <div className="space-y-3">
        {referrals.map(r => (
          <Card key={r.id} className="flex items-start justify-between">
            <div>
              <p className="font-medium">{r.product?.title || 'Товар'}</p>
              <p className="text-sm text-gray-500">Покупатель: {r.buyer?.name || '—'}</p>
              <p className="text-xs text-gray-400 mt-1">
                {format(new Date(r.createdAt), 'dd MMM yyyy', { locale: ru })}
              </p>
            </div>
            <div className="text-right">
              <p className="font-semibold text-green-600">+{r.referralBonus.toLocaleString()} ₽</p>
              <p className="text-xs text-gray-500">Сумма заказа: {r.amount.toLocaleString()} ₽</p>
            </div>
          </Card>
        ))}
        {referrals.length === 0 && (
          <p className="text-center text-gray-500">Пока нет реферальных начислений</p>
        )}
      </div>
    </div>
  );
}