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
import EmptyState from '../components/ui/EmptyState';
import toast from 'react-hot-toast';
import api from '../api/axios';
import { useApp } from '../context/AppContext';
import ProductCard from '../components/ProductCard';

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

  // Данные для вкладок
  const [orders, setOrders] = useState<any[]>([]);
  const [favProducts, setFavProducts] = useState<any[]>([]);
  const [referrals, setReferrals] = useState<any[]>([]);
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [loadingTab, setLoadingTab] = useState(false);

  const { favorites } = useApp(); // избранное из контекста

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

  // Загрузка данных для вкладки
  useEffect(() => {
    if (!profile) return;
    setLoadingTab(true);
    const fetchTabData = async () => {
      try {
        switch (activeTab) {
          case 'orders':
            const ordersRes = await api.get('/orders/my');
            setOrders(ordersRes.data);
            break;
          case 'favorites':
            // загружаем все товары и фильтруем по избранному
            const productsRes = await api.get('/products');
            const allProducts = productsRes.data;
            setFavProducts(allProducts.filter((p: any) => favorites.includes(p.id)));
            break;
          case 'referrals':
            const refRes = await api.get('/users/me/referrals');
            setReferrals(refRes.data);
            break;
          case 'withdrawals':
            const wdRes = await api.get('/users/me/withdrawals');
            setWithdrawals(wdRes.data);
            break;
        }
      } catch (err) {
        console.error('Failed to load tab data', err);
      } finally {
        setLoadingTab(false);
      }
    };
    fetchTabData();
  }, [activeTab, profile, favorites]);

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

  const statusMap: Record<string, string> = {
    PENDING: 'Ожидает',
    PAID: 'Оплачен',
    SHIPPED: 'Отправлен',
    COMPLETED: 'Завершён',
    CANCELLED: 'Отменён',
  };

  const withdrawalStatusMap: Record<string, string> = {
    pending: 'На рассмотрении',
    approved: 'Одобрена',
    rejected: 'Отклонена',
  };

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

      {/* Вкладки */}
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

      {/* Содержимое вкладок */}
      <motion.div
        key={activeTab}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        {activeTab === 'info' && (
          <Card>
            <p className="text-gray-500">Добро пожаловать в ваш профиль! Здесь отображается основная информация.</p>
          </Card>
        )}

        {activeTab === 'orders' && (
          <div className="space-y-4">
            {loadingTab ? (
              <Skeleton className="h-40 rounded-3xl" />
            ) : orders.length === 0 ? (
              <EmptyState message="Заказов пока нет" />
            ) : (
              orders.map((o: any) => (
                <Card key={o.id} className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold">{o.product?.title || 'Товар'}</h3>
                    <p className="text-sm text-gray-500">Сумма: {o.amount.toLocaleString()} ₽</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      o.status === 'PAID' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {statusMap[o.status] || o.status}
                    </span>
                  </div>
                </Card>
              ))
            )}
          </div>
        )}

        {activeTab === 'favorites' && (
          <div className="space-y-4">
            {loadingTab ? (
              <Skeleton className="h-40 rounded-3xl" />
            ) : favProducts.length === 0 ? (
              <EmptyState message="Нет избранных товаров" />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {favProducts.map((p: any) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'referrals' && (
          <div className="space-y-4">
            {loadingTab ? (
              <Skeleton className="h-40 rounded-3xl" />
            ) : referrals.length === 0 ? (
              <EmptyState message="Реферальных начислений пока нет" />
            ) : (
              referrals.map((r: any) => (
                <Card key={r.id} className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{r.product?.title || 'Товар'}</p>
                    <p className="text-sm text-gray-500">Покупатель: {r.buyer?.name}</p>
                    <p className="text-sm text-green-600">+{r.referralBonus.toLocaleString()} ₽</p>
                  </div>
                </Card>
              ))
            )}
          </div>
        )}

        {activeTab === 'withdrawals' && (
          <div className="space-y-4">
            {loadingTab ? (
              <Skeleton className="h-40 rounded-3xl" />
            ) : withdrawals.length === 0 ? (
              <EmptyState message="Заявок на вывод пока нет" />
            ) : (
              withdrawals.map((w: any) => (
                <Card key={w.id} className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{w.amount.toLocaleString()} ₽</p>
                    <p className={`text-sm ${w.status === 'approved' ? 'text-green-600' : w.status === 'rejected' ? 'text-red-500' : 'text-yellow-600'}`}>
                      {withdrawalStatusMap[w.status] || w.status}
                    </p>
                  </div>
                </Card>
              ))
            )}
          </div>
        )}
      </motion.div>

      <div className="text-center text-sm text-gray-500">
        <Link to="/privacy" className="hover:underline">Политика приватности</Link>
      </div>
    </div>
  );
}