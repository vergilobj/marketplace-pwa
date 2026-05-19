import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { User, Phone, Gift, Bell, LogIn, Edit3, Save, X } from 'lucide-react';
import { getProfile, updateProfile } from '../api/users';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import toast from 'react-hot-toast';

export default function ProfilePage() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      setError('Необходимо войти');
      setLoading(false);
      return;
    }

    getProfile()
      .then((data) => {
        setProfile(data);
        setEditName(data.name);
        setEditPhone(data.phone);
      })
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

  const handleSave = async () => {
    try {
      const updated = await updateProfile({ name: editName, phone: editPhone });
      setProfile(updated);
      setIsEditing(false);
      toast.success('Профиль обновлён');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Ошибка сохранения');
    }
  };

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
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <User className="w-5 h-5 text-gray-400" />
              <div>
                <p className="text-sm text-gray-500">Имя</p>
                {isEditing ? (
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="mt-1"
                  />
                ) : (
                  <p className="font-semibold">{profile.name}</p>
                )}
              </div>
            </div>
            {isEditing ? (
              <div className="flex gap-2">
                <button onClick={handleSave} className="p-1 text-green-600"><Save size={18} /></button>
                <button onClick={() => { setIsEditing(false); setEditName(profile.name); setEditPhone(profile.phone); }} className="p-1 text-gray-400"><X size={18} /></button>
              </div>
            ) : (
              <button onClick={() => setIsEditing(true)} className="p-1 text-gray-400 hover:text-blue-600"><Edit3 size={18} /></button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Phone className="w-5 h-5 text-gray-400" />
            <div>
              <p className="text-sm text-gray-500">Телефон</p>
              {isEditing ? (
                <Input
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  className="mt-1"
                />
              ) : (
                <p className="font-semibold">{profile.phone}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Gift className="w-5 h-5 text-gray-400" />
            <div>
              <p className="text-sm text-gray-500">Реферальный код</p>
              <p className="font-semibold">{profile.referralCode}</p>
            </div>
          </div>
          <Link to="/referrals" className="text-sm text-blue-600 hover:underline">
            История начислений
          </Link>
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
      <div className="text-center text-sm text-gray-500 mt-4">
        <Link to="/privacy" className="hover:underline">Политика приватности</Link>
      </div>
    </div>
  );
}