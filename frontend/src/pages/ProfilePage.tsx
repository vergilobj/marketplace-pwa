import React, { useEffect, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  User, Phone, Gift, Bell, Camera, Package, Heart, Users, Wallet,
  ShoppingBag, TrendingUp, LogIn
} from 'lucide-react';
import { getProfile, updateProfile, getStats } from '../api/users';
import { uploadImage } from '../api/upload';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Skeleton from '../components/ui/Skeleton';
import toast from 'react-hot-toast';

type Tab = 'info' | 'orders' | 'favorites' | 'referrals' | 'withdrawals';

export default function ProfilePage() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('info');
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [profileData, statsData] = await Promise.all([getProfile(), getStats()]);
      setProfile(profileData);
      setStats(statsData);
      setEditName(profileData.name);
      setEditPhone(profileData.phone);
    } catch (err: any) {
      console.error('Profile load error', err);
      if (err?.response?.status === 401) {
        setError('Сессия истекла. Войдите заново.');
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('userId');
      } else {
        setError('Не удалось загрузить профиль');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    if ('Notification' in window) setPermission(Notification.permission);
  }, []);

  const handleSaveProfile = async () => {
    try {
      const updated = await updateProfile({ name: editName, phone: editPhone });
      setProfile(updated);
      setIsEditing(false);
      toast.success('Профиль обновлён');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Ошибка сохранения');
    }
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const url = await uploadImage(file);
      const updated = await updateProfile({ avatar: url });
      setProfile(updated);
      toast.success('Аватар обновлён');
    } catch (err: any) {
      toast.error('Не удалось загрузить аватар');
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

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-8">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Skeleton className="h-40 rounded-3xl" />
          <Skeleton className="h-40 rounded-3xl" />
          <Skeleton className="h-40 rounded-3xl" />
        </div>
        <Skeleton className="h-64 rounded-3xl" />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="max-w-xl mx-auto text-center space-y-4 py-20">
        <p className="text-red-500">{error || 'Профиль не загружен'}</p>
        <Button variant="primary" onClick={() => navigate('/login')}>
          <LogIn size={18} className="mr-2" /> Войти
        </Button>
      </div>
    );
  }

  const tabs: { key: Tab; label: string; icon: React.ComponentType<any> }[] = [
    { key: 'info', label: 'Инфо', icon: User },
    { key: 'orders', label: 'Заказы', icon: Package },
    { key: 'favorites', label: 'Избранное', icon: Heart },
    { key: 'referrals', label: 'Рефералы', icon: Users },
    { key: 'withdrawals', label: 'Выводы', icon: Wallet },
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <h1 className="text-3xl font-bold">Профиль</h1>

      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="flex items-center gap-4">
            <div className="p-3 bg-green-100 dark:bg-green-900/30 rounded-2xl">
              <ShoppingBag size={22} className="text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Куплено</p>
              <p className="text-xl font-bold">{stats.boughtCount}</p>
            </div>
          </Card>
          <Card className="flex items-center gap-4">
            <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-2xl">
              <TrendingUp size={22} className="text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Продано</p>
              <p className="text-xl font-bold">{stats.soldCount}</p>
            </div>
          </Card>
          <Card className="flex items-center gap-4">
            <div className="p-3 bg-purple-100 dark:bg-purple-900/30 rounded-2xl">
              <Gift size={22} className="text-purple-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Заработано</p>
              <p className="text-xl font-bold">{stats.referralEarned.toLocaleString()} ₽</p>
            </div>
          </Card>
          <Card className="flex items-center gap-4">
            <div className="p-3 bg-orange-100 dark:bg-orange-900/30 rounded-2xl">
              <Wallet size={22} className="text-orange-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Баланс</p>
              <p className="text-xl font-bold">{stats.bonusBalance.toLocaleString()} ₽</p>
            </div>
          </Card>
        </div>
      )}

      <Card>
        <div className="flex flex-col sm:flex-row items-center gap-6">
          <div className="relative group">
            <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white text-3xl font-bold overflow-hidden">
              {profile.avatar ? (
                <img
                  src={profile.avatar}
                  alt={profile.name}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    const img = e.target as HTMLImageElement;
                    img.style.display = 'none';
                    const parent = img.parentElement;
                    if (parent) {
                      parent.innerHTML = profile.name?.[0] || '?';
                    }
                  }}
                />
              ) : (
                profile.name?.[0] || '?'
              )}
            </div>
            <button
              onClick={() => avatarInputRef.current?.click()}
              className="absolute inset-0 bg-black/40 rounded-2xl opacity-0 group-hover:opacity-100 transition flex items-center justify-center"
            >
              <Camera size={20} className="text-white" />
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              onChange={handleAvatarChange}
              className="hidden"
            />
          </div>
          <div className="flex-1 text-center sm:text-left">
            <h2 className="text-2xl font-bold">{profile.name}</h2>
            <p className="text-gray-500">{profile.phone}</p>
            <p className="text-sm text-gray-400 mt-1">
              Реферальный код: <span className="font-mono font-bold">{profile.referralCode}</span>
            </p>
          </div>
          <Button variant="ghost" onClick={() => setIsEditing(!isEditing)}>
            {isEditing ? 'Отменить' : 'Редактировать'}
          </Button>
        </div>

        {isEditing && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mt-6 space-y-3 border-t pt-4"
          >
            <Input label="Имя" value={editName} onChange={e => setEditName(e.target.value)} />
            <Input label="Телефон" value={editPhone} onChange={e => setEditPhone(e.target.value)} />
            <Button onClick={handleSaveProfile}>Сохранить</Button>
          </motion.div>
        )}
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

      <div className="flex gap-2 overflow-x-auto pb-1">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition whitespace-nowrap ${
              activeTab === tab.key
                ? 'bg-blue-600 text-white shadow'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            <tab.icon size={16} />
            {tab.label}
          </button>
        ))}
      </div>

      <motion.div
        key={activeTab}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        {activeTab === 'info' && (
          <Card>
            <p className="text-gray-500">Добро пожаловать в ваш профиль! Здесь будет отображаться основная информация.</p>
          </Card>
        )}
        {activeTab === 'orders' && (
          <Card>
            <p>Список заказов будет здесь (скоро).</p>
          </Card>
        )}
        {activeTab === 'favorites' && (
          <Card>
            <p>Избранные товары будут здесь (скоро).</p>
          </Card>
        )}
        {activeTab === 'referrals' && (
          <Card>
            <p>Реферальная история будет здесь (скоро).</p>
          </Card>
        )}
        {activeTab === 'withdrawals' && (
          <Card>
            <p>Запросы на вывод будут здесь (скоро).</p>
          </Card>
        )}
      </motion.div>

      <div className="text-center text-sm text-gray-500">
        <Link to="/privacy" className="hover:underline">Политика приватности</Link>
      </div>
    </div>
  );
}