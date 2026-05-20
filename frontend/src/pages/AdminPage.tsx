import React, { useEffect, useState } from 'react';
import api from '../api/axios';
import { getInvites, createInvite, deleteInvite } from '../api/invites';
import Card from '../components/ui/Card';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import Tabs from '../components/ui/Tabs';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Users, ShoppingBag, Newspaper, Wallet, AlertTriangle } from 'lucide-react';

const statusMap: Record<string, string> = {
  pending: 'На рассмотрении',
  approved: 'Одобрена',
  rejected: 'Отклонена',
};
const withdrawalStatusColor = (s: string) => {
  switch (s) {
    case 'approved': return 'bg-green-100 text-green-700';
    case 'rejected': return 'bg-red-100 text-red-700';
    default: return 'bg-yellow-100 text-yellow-700';
  }
};

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState('Дашборд');
  const [settings, setSettings] = useState<any>({});
  const [dashboard, setDashboard] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [posts, setPosts] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [invites, setInvites] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [modLogs, setModLogs] = useState<any[]>([]);

  // Pagination / filters
  const [userPage, setUserPage] = useState(1);
  const [postPage, setPostPage] = useState(1);
  const [productPage, setProductPage] = useState(1);
  const [postFilter, setPostFilter] = useState('');
  const [productFilter, setProductFilter] = useState('');
  const [userSearch, setUserSearch] = useState('');

  useEffect(() => {
    api.get('/settings').then(r => {
      const map: any = {};
      r.data.forEach((s: any) => (map[s.key] = s.value));
      setSettings(map);
    });
    api.get('/admin/dashboard').then(r => setDashboard(r.data));
  }, []);

  const loadUsers = () =>
    api.get(`/users?page=${userPage}&limit=10&search=${userSearch}`).then(r => setUsers(r.data.items));
  const loadPosts = () =>
    api.get(`/posts/admin/list?page=${postPage}&limit=10&search=${postFilter}`).then(r => setPosts(r.data.items));
  const loadProducts = () =>
    api.get(`/products/admin/list?page=${productPage}&limit=10&search=${productFilter}`).then(r => setProducts(r.data.items));
  const loadInvites = () => getInvites().then(setInvites);
  const loadTransactions = () => api.get('/payments/transactions').then(r => setTransactions(r.data));
  const loadWithdrawals = () => api.get('/users/admin/withdrawals').then(r => setWithdrawals(r.data));
  const loadModLogs = () => api.get('/admin/moderation-logs?limit=20').then(r => setModLogs(r.data.items));

  useEffect(() => {
    if (activeTab === 'Пользователи') loadUsers();
    else if (activeTab === 'Посты') loadPosts();
    else if (activeTab === 'Товары') loadProducts();
    else if (activeTab === 'Инвайты') loadInvites();
    else if (activeTab === 'Транзакции') loadTransactions();
    else if (activeTab === 'Выводы') loadWithdrawals();
    else if (activeTab === 'Логи') loadModLogs();
  }, [activeTab, userPage, postPage, productPage, postFilter, productFilter, userSearch]);

  const updateSetting = (key: string, value: string) => {
    api.put('/settings', { key, value }).then(() => toast.success('Настройка обновлена'));
  };
  const togglePostVisibility = async (id: string) => {
    await api.patch(`/posts/${id}/toggle-visibility`);
    loadPosts();
  };
  const deletePost = async (id: string) => {
    if (!confirm('Удалить пост?')) return;
    await api.delete(`/posts/${id}`);
    loadPosts();
  };
  const toggleProductActive = async (id: string) => {
    await api.patch(`/products/${id}/toggle-active`);
    loadProducts();
  };
  const deleteProduct = async (id: string) => {
    if (!confirm('Удалить товар?')) return;
    await api.delete(`/products/admin/${id}`);
    loadProducts();
  };
  const handleCreateInvite = async () => {
    try {
      await createInvite();
      toast.success('Инвайт создан');
      loadInvites();
    } catch (err) { toast.error('Не удалось создать инвайт'); }
  };
  const handleDeleteInvite = async (code: string) => {
    if (!confirm('Удалить инвайт?')) return;
    try {
      await deleteInvite(code);
      toast.success('Инвайт удалён');
      loadInvites();
    } catch (err) { toast.error('Не удалось удалить инвайт'); }
  };
  const handleApproveWithdrawal = async (id: string) => {
    await api.patch(`/users/admin/withdrawals/${id}/approve`);
    loadWithdrawals();
  };
  const handleRejectWithdrawal = async (id: string) => {
    await api.patch(`/users/admin/withdrawals/${id}/reject`);
    loadWithdrawals();
  };
  const handleChangeRole = async (userId: string, newRole: string) => {
    try {
      await api.patch(`/users/${userId}/role`, { role: newRole });
      toast.success('Роль изменена');
      loadUsers();
    } catch (err) { toast.error('Не удалось изменить роль'); }
  };

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Админ-панель</h1>
      <Tabs
        tabs={['Дашборд', 'Посты', 'Товары', 'Пользователи', 'Инвайты', 'Транзакции', 'Выводы', 'Логи', 'Настройки']}
        active={activeTab}
        onChange={setActiveTab}
      />

      {/* Дашборд */}
      {activeTab === 'Дашборд' && dashboard && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="flex items-center gap-4">
            <Users size={24} className="text-blue-600" />
            <div><p className="text-sm text-gray-500">Пользователи</p><p className="text-2xl font-bold">{dashboard.usersCount}</p></div>
          </Card>
          <Card className="flex items-center gap-4">
            <ShoppingBag size={24} className="text-green-600" />
            <div><p className="text-sm text-gray-500">Заказы</p><p className="text-2xl font-bold">{dashboard.ordersCount}</p></div>
          </Card>
          <Card className="flex items-center gap-4">
            <Newspaper size={24} className="text-orange-600" />
            <div><p className="text-sm text-gray-500">Товары</p><p className="text-2xl font-bold">{dashboard.productsCount}</p></div>
          </Card>
          <Card className="flex items-center gap-4">
            <Wallet size={24} className="text-purple-600" />
            <div><p className="text-sm text-gray-500">Выручка</p><p className="text-2xl font-bold">{dashboard.totalRevenue.toLocaleString()} ₽</p></div>
          </Card>
        </div>
      )}

      {/* Посты */}
      {activeTab === 'Посты' && (
        <Card>
          <h2 className="text-xl font-bold mb-4">Посты</h2>
          <div className="flex gap-2 mb-4">
            <Input placeholder="Поиск..." value={postFilter} onChange={e => setPostFilter(e.target.value)} />
            <Button size="sm" onClick={() => setPostPage(1)}>Искать</Button>
          </div>
          <div className="space-y-2">
            {posts.map((p: any) => (
              <div key={p.id} className="flex items-center justify-between border-b pb-2">
                <div>
                  <span className="font-medium">{p.title}</span>
                  <span className="ml-2 text-sm text-gray-500">{p.isAd ? 'Реклама' : 'Обычный'}</span>
                  <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${p.isHidden ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{p.isHidden ? 'Скрыт' : 'Активен'}</span>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => togglePostVisibility(p.id)}>{p.isHidden ? 'Показать' : 'Скрыть'}</Button>
                  <Button variant="ghost" size="sm" className="text-red-500" onClick={() => deletePost(p.id)}>Удалить</Button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-4">
            <Button disabled={postPage <= 1} onClick={() => setPostPage(p => p - 1)}>Назад</Button>
            <span>Страница {postPage}</span>
            <Button onClick={() => setPostPage(p => p + 1)}>Вперед</Button>
          </div>
        </Card>
      )}

      {/* Товары */}
      {activeTab === 'Товары' && (
        <Card>
          <h2 className="text-xl font-bold mb-4">Товары</h2>
          <div className="flex gap-2 mb-4">
            <Input placeholder="Поиск..." value={productFilter} onChange={e => setProductFilter(e.target.value)} />
            <Button size="sm" onClick={() => setProductPage(1)}>Искать</Button>
          </div>
          <div className="space-y-2">
            {products.map((p: any) => (
              <div key={p.id} className="flex items-center justify-between border-b pb-2">
                <div>
                  <span className="font-medium">{p.title}</span>
                  <span className="ml-2 text-sm text-gray-500">{p.price} ₽</span>
                  <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${p.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{p.isActive ? 'Активен' : 'Скрыт'}</span>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => toggleProductActive(p.id)}>{p.isActive ? 'Скрыть' : 'Показать'}</Button>
                  <Button variant="ghost" size="sm" className="text-red-500" onClick={() => deleteProduct(p.id)}>Удалить</Button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-4">
            <Button disabled={productPage <= 1} onClick={() => setProductPage(p => p - 1)}>Назад</Button>
            <span>Страница {productPage}</span>
            <Button onClick={() => setProductPage(p => p + 1)}>Вперед</Button>
          </div>
        </Card>
      )}

      {/* Пользователи */}
      {activeTab === 'Пользователи' && (
        <Card>
          <h2 className="text-xl font-bold mb-4">Пользователи</h2>
          <div className="flex gap-2 mb-4">
            <Input placeholder="Поиск..." value={userSearch} onChange={e => setUserSearch(e.target.value)} />
            <Button size="sm" onClick={() => setUserPage(1)}>Искать</Button>
          </div>
          <div className="space-y-2">
            {users.map((u: any) => (
              <div key={u.id} className="flex justify-between items-center">
                <div>
                  <span className="font-medium">{u.name}</span> ({u.phone}) – {u.role}
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={u.role}
                    onChange={(e) => handleChangeRole(u.id, e.target.value)}
                    className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-700"
                  >
                    <option value="BUYER">BUYER</option>
                    <option value="SELLER">SELLER</option>
                    <option value="MODERATOR">MODERATOR</option>
                    <option value="ADMIN">ADMIN</option>
                  </select>
                  <Button variant="ghost" size="sm" onClick={async () => {
                    if (!confirm('Экспорт CSV?')) return;
                    try {
                      const token = localStorage.getItem('accessToken');
                      const res = await fetch('/api/users/export', { headers: { Authorization: `Bearer ${token}` } });
                      const blob = await res.blob();
                      const url = window.URL.createObjectURL(blob);
                      const a = document.createElement('a'); a.href = url; a.download = 'users.csv'; a.click(); window.URL.revokeObjectURL(url);
                    } catch { toast.error('Ошибка экспорта'); }
                  }}>CSV</Button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-4">
            <Button disabled={userPage <= 1} onClick={() => setUserPage(p => p - 1)}>Назад</Button>
            <span>Страница {userPage}</span>
            <Button onClick={() => setUserPage(p => p + 1)}>Вперед</Button>
          </div>
        </Card>
      )}

      {/* Инвайты */}
      {activeTab === 'Инвайты' && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">Инвайты</h2>
            <Button variant="primary" size="sm" onClick={handleCreateInvite}>Сгенерировать новый</Button>
          </div>
          <div className="space-y-2">
            {invites.map((inv: any) => (
              <div key={inv.code} className="flex items-center justify-between border-b pb-2">
                <div>
                  <p className="font-mono text-sm">{inv.code}</p>
                  <p className="text-xs text-gray-500">
                    Создан: {inv.owner?.name || '—'} &nbsp;
                    {inv.createdAt && format(new Date(inv.createdAt), 'dd MMM HH:mm', { locale: ru })}
                  </p>
                  <p className="text-xs">
                    {inv.isUsed ? (
                      <span className="text-green-600">Использован: {inv.usedBy?.name || inv.usedById}</span>
                    ) : (
                      <span className="text-yellow-600">Не использован</span>
                    )}
                  </p>
                </div>
                <Button variant="ghost" size="sm" className="text-red-500" onClick={() => handleDeleteInvite(inv.code)}>Удалить</Button>
              </div>
            ))}
            {invites.length === 0 && <p className="text-center text-gray-500">Нет инвайтов</p>}
          </div>
        </Card>
      )}

      {/* Транзакции */}
      {activeTab === 'Транзакции' && (
        <Card>
          <h2 className="text-xl font-bold mb-4">Транзакции</h2>
          <div className="space-y-2">
            {transactions.map((t: any) => (
              <div key={t.id} className="flex items-center justify-between border-b pb-2">
                <div>
                  <p className="font-medium text-sm">{t.type}</p>
                  <p className="text-xs text-gray-500">Заказ: {t.order?.id?.slice(0, 8)}... | Сумма: {t.amount.toLocaleString()} ₽</p>
                </div>
                <div className="text-right">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${t.status === 'success' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>{t.status}</span>
                  <p className="text-xs text-gray-400 mt-1">{format(new Date(t.createdAt), 'dd MMM HH:mm', { locale: ru })}</p>
                </div>
              </div>
            ))}
            {transactions.length === 0 && <p className="text-center text-gray-500">Транзакций пока нет</p>}
          </div>
        </Card>
      )}

      {/* Выводы */}
      {activeTab === 'Выводы' && (
        <Card>
          <h2 className="text-xl font-bold mb-4">Запросы на вывод</h2>
          <div className="space-y-2">
            {withdrawals.map((w: any) => (
              <div key={w.id} className="flex items-center justify-between border-b pb-2">
                <div>
                  <p className="font-medium">{w.amount.toLocaleString()} ₽</p>
                  <p className="text-sm text-gray-500">{w.user?.name} ({w.user?.phone}) &nbsp;{w.createdAt && format(new Date(w.createdAt), 'dd MMM HH:mm', { locale: ru })}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${withdrawalStatusColor(w.status)}`}>{statusMap[w.status] || w.status}</span>
                </div>
                {w.status === 'pending' && (
                  <div className="flex gap-2">
                    <Button variant="primary" size="sm" onClick={() => handleApproveWithdrawal(w.id)}>Одобрить</Button>
                    <Button variant="ghost" size="sm" className="text-red-500" onClick={() => handleRejectWithdrawal(w.id)}>Отклонить</Button>
                  </div>
                )}
              </div>
            ))}
            {withdrawals.length === 0 && <p className="text-center text-gray-500">Нет запросов на вывод</p>}
          </div>
        </Card>
      )}

      {/* Логи модерации */}
      {activeTab === 'Логи' && (
        <Card>
          <h2 className="text-xl font-bold mb-4">Логи модерации</h2>
          <div className="space-y-2">
            {modLogs.map((log: any) => (
              <div key={log.id} className="text-sm border-b pb-1">
                <span className="font-medium">Msg ID:</span> {log.chatMsgId} | {log.reason} → <span className="text-red-500">{log.action}</span>
                <span className="ml-2 text-xs text-gray-400">{format(new Date(log.createdAt), 'HH:mm dd MMM', { locale: ru })}</span>
              </div>
            ))}
            {modLogs.length === 0 && <p className="text-center text-gray-500">Логов пока нет</p>}
          </div>
        </Card>
      )}

      {/* Настройки */}
      {activeTab === 'Настройки' && (
        <Card>
          <h2 className="text-xl font-bold mb-4">Настройки комиссий</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label>Комиссия платформы (%)</label>
              <Input value={settings.platform_fee_percent || ''} onChange={e => setSettings({...settings, platform_fee_percent: e.target.value})} onBlur={() => updateSetting('platform_fee_percent', settings.platform_fee_percent)} />
            </div>
            <div>
              <label>Реферальный процент (%)</label>
              <Input value={settings.referral_percent || ''} onChange={e => setSettings({...settings, referral_percent: e.target.value})} onBlur={() => updateSetting('referral_percent', settings.referral_percent)} />
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}