import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Phone, Gift, Bell, LogIn } from 'lucide-react';
import { getProfile } from '../api/users';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';

export default function ProfilePage() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [permission, setPermission] = useState<NotificationPermission>('default');

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      setError('Необходимо войти');
      setLoading(false);
      return;
    }

    getProfile()
      .then(setProfile)
      .catch((err) => {
        if (err.response?.status === 401) {
          setError('Сессия истекла. Войдите заново.');
        } else {
          setError('Не удалось загрузить профиль');
        }
      })
      .finally(() => setLoading(false));

    if ('Notification' in window) {
      setPermission(Notification.permission);
    }
  }, []);

  const requestPermission = async () => {
    if (window.OneSignal) {
      await window.OneSignal.Notifications.requestPermission();
      setPermission(Notification.permission);
    } else {
      window.OneSignalDeferred?.push(async (OneSignal: any) => {
        await OneSignal.Notifications.requestPermission();
        setPermission(Notification.permission);
      });
    }
  };

  if (loading) return <p className="text-center text-gray-500 py-10">Загрузка...</p>;

  if (error) {
    return (
      <div className="max-w-xl mx-auto text-center space-y-4 py-10">
        <p className="text-red-500">{error}</p>
        <Button variant="primary" onClick={() => navigate('/login')}>
          <LogIn size={18} className="mr-2" /> Войти
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold">Профиль</h1>
      <Card>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <User className="w-5 h-5 text-gray-400" />
            <div>
              <p className="text-sm text-gray-500">Имя</p>
              <p className="font-semibold">{profile.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Phone className="w-5 h-5 text-gray-400" />
            <div>
              <p className="text-sm text-gray-500">Телефон</p>
              <p className="font-semibold">{profile.phone}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Gift className="w-5 h-5 text-gray-400" />
            <div>
              <p className="text-sm text-gray-500">Реферальный код</p>
              <p className="font-semibold">{profile.referralCode}</p>
            </div>
          </div>
        </div>
      </Card>
      <Card>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Bell className="w-5 h-5 text-gray-400" />
            <div>
              <p className="text-sm text-gray-500">Уведомления</p>
              <p className="font-semibold">
                {permission === 'granted' ? 'Разрешены' : permission === 'denied' ? 'Заблокированы' : 'Не настроены'}
              </p>
            </div>
          </div>
          {permission !== 'granted' && (
            <Button variant="secondary" size="sm" onClick={requestPermission}>
              Включить
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}