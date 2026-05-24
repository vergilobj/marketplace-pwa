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
import { Users, ShoppingBag, Newspaper, Wallet, X } from 'lucide-react';

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
  const [sellers, setSellers] = useState<any[]>([]);

  // Параметры пагинации и фильтров
  const [userPage, setUserPage] = useState(1);
  const [postPage, setPostPage] = useState(1);
  const [productPage, setProductPage] = useState(1);
  const [modLogPage, setModLogPage] = useState(1);
  const [transPage, setTransPage] = useState(1);
  const [postFilter, setPostFilter] = useState('');
  const [productFilter, setProductFilter] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [transTypeFilter, setTransTypeFilter] = useState('');
  const [transOrderSearch, setTransOrderSearch] = useState('');
  const [exporting, setExporting] = useState(false);

  // Массовые действия с пользователями
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [batchRole, setBatchRole] = useState('BUYER');
  const [batchLoading, setBatchLoading] = useState(false);

  // Редактирование товара
  const [editProduct, setEditProduct] = useState<any>(null);
  const [editForm, setEditForm] = useState({ title: '', description: '', price: '' });
  const [editLoading, setEditLoading] = useState(false);

  const [inviteCode, setInviteCode] = useState('');

  // Автообновление дашборда каждые 30 секунд
  useEffect(() => {
    api.get('/settings').then(r => {
      const map: any = {};
      r.data.forEach((s: any) => (map[s.key] = s.value));
      setSettings(map);
    });
    const fetchDashboard = () => api.get('/admin/dashboard').then(r => setDashboard(r.data));
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadUsers = () =>
    api.get(`/users?page=${userPage}&limit=10&search=${userSearch}`).then(r => {
      setUsers(r.data.items);
      setSelectedUserIds(new Set());
    });
  const loadPosts = () =>
    api.get(`/posts/admin/list?page=${postPage}&limit=10&search=${postFilter}`).then(r => setPosts(r.data.items));
  const loadProducts = () =>
    api.get(`/products/admin/list?page=${productPage}&limit=10&search=${productFilter}`).then(r => setProducts(r.data.items));
  const loadInvites = () => getInvites().then(setInvites);
  const loadTransactions = () =>
    api.get(`/payments/transactions?page=${transPage}&limit=10&type=${transTypeFilter}&orderSearch=${transOrderSearch}`).then(r => setTransactions(r.data.items));
  const loadWithdrawals = () => api.get('/users/admin/withdrawals').then(r => setWithdrawals(r.data));
  const loadModLogs = () =>
    api.get(`/admin/moderation-logs?page=${modLogPage}&limit=10`).then(r => setModLogs(r.data.items));
  const loadSellers = () =>
    api.get('/admin/seller-stats').then(r => setSellers(r.data));

  useEffect(() => {
    if (activeTab === 'Пользователи') loadUsers();
    else if (activeTab === 'Посты') loadPosts();
    else if (activeTab === 'Товары') loadProducts();
    else if (activeTab === 'Инвайты') loadInvites();
    else if (activeTab === 'Транзакции') loadTransactions();
    else if (activeTab === 'Выводы') loadWithdrawals();
    else if (activeTab === 'Логи') loadModLogs();
    else if (activeTab === 'Продавцы') loadSellers();
    else if (activeTab === 'Рассылка') {};
  }, [activeTab, userPage, postPage, productPage, modLogPage, transPage, postFilter, productFilter, userSearch, transTypeFilter, transOrderSearch]);

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

  const handleEditProduct = (product: any) => {
    setEditProduct(product);
    setEditForm({
      title: product.title,
      description: product.description || '',
      price: String(product.price),
    });
  };

  const handleSaveProduct = async () => {
    if (!editProduct) return;
    setEditLoading(true);
    try {
      await api.patch(`/products/admin/${editProduct.id}`, {
        title: editForm.title,
        description: editForm.description,
        price: parseFloat(editForm.price),
      });
      toast.success('Товар обновлён');
      setEditProduct(null);
      loadProducts();
    } catch (err) {
      toast.error('Ошибка при сохранении');
    } finally {
      setEditLoading(false);
    }
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
    if (!confirm(`Вы уверены, что хотите изменить роль на ${newRole}?`)) return;
    try {
      await api.patch(`/users/${userId}/role`, { role: newRole });
      toast.success('Роль изменена');
      loadUsers();
    } catch (err) { toast.error('Не удалось изменить роль'); }
  };

  const handleExportCSV = async () => {
    setExporting(true);
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch('/api/users/export', { headers: { Authorization: `Bearer ${token}` } });
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'users.csv'; a.click();
      window.URL.revokeObjectURL(url);
    } catch { toast.error('Ошибка экспорта'); }
    finally { setExporting(false); }
  };

  const toggleUserSelection = (userId: string) => {
    setSelectedUserIds(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const handleBatchApprove = async () => {
    if (selectedUserIds.size === 0) return toast.error('Выберите пользователей');
    setBatchLoading(true);
    try {
      await api.patch('/users/batch/approve', { userIds: Array.from(selectedUserIds) });
      toast.success('Пользователи одобрены');
      setSelectedUserIds(new Set());
      loadUsers();
    } catch (err) { toast.error('Ошибка при массовом подтверждении'); }
    finally { setBatchLoading(false); }
  };

  const handleBatchChangeRole = async () => {
    if (selectedUserIds.size === 0) return toast.error('Выберите пользователей');
    if (!confirm(`Изменить роль выбранных пользователей на ${batchRole}?`)) return;
    setBatchLoading(true);
    try {
      await api.patch('/users/batch/role', { userIds: Array.from(selectedUserIds), role: batchRole });
      toast.success('Роли обновлены');
      setSelectedUserIds(new Set());
      loadUsers();
    } catch (err) { toast.error('Ошибка при массовом изменении роли'); }
    finally { setBatchLoading(false); }
  };

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Админ-панель</h1>
      <Tabs
        tabs={['Дашборд', 'Посты', 'Товары', 'Пользователи', 'Продавцы', 'Инвайты', 'Транзакции', 'Выводы', 'Логи', 'Настройки', 'Рассылка']}
        active={activeTab}
        onChange={setActiveTab}
      />

      {/* Дашборд */}
      {activeTab === 'Дашборд' && dashboard && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="flex items-center gap-4"><Users size={24} className="text-blue-600" /><div><p className="text-sm text-gray-500">Пользователи</p><p className="text-2xl font-bold">{dashboard.usersCount}</p></div></Card>
          <Card className="flex items-center gap-4"><ShoppingBag size={24} className="text-green-600" /><div><p className="text-sm text-gray-500">Заказы</p><p className="text-2xl font-bold">{dashboard.ordersCount}</p></div></Card>
          <Card className="flex items-center gap-4"><Newspaper size={24} className="text-orange-600" /><div><p className="text-sm text-gray-500">Товары</p><p className="text-2xl font-bold">{dashboard.productsCount}</p></div></Card>
          <Card className="flex items-center gap-4"><Wallet size={24} className="text-purple-600" /><div><p className="text-sm text-gray-500">Выручка</p><p className="text-2xl font-bold">{dashboard.totalRevenue.toLocaleString()} ₽</p></div></Card>
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
                  {p.seller && <span className="ml-2 text-xs text-gray-400">({p.seller.name})</span>}
                  <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${p.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{p.isActive ? 'Активен' : 'Скрыт'}</span>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => handleEditProduct(p)}>Редактировать</Button>
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
          <div className="flex flex-wrap gap-2 mb-4 items-center">
            <Input placeholder="Поиск..." value={userSearch} onChange={e => setUserSearch(e.target.value)} className="max-w-xs" />
            <Button size="sm" onClick={() => setUserPage(1)}>Искать</Button>
            <div className="flex-1" />
            {selectedUserIds.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">{selectedUserIds.size} выбрано</span>
                <Button size="sm" variant="primary" onClick={handleBatchApprove} loading={batchLoading}>Одобрить</Button>
                <select value={batchRole} onChange={e => setBatchRole(e.target.value)} className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-700">
                  <option value="BUYER">BUYER</option>
                  <option value="SELLER">SELLER</option>
                  <option value="MODERATOR">MODERATOR</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
                <Button size="sm" variant="secondary" onClick={handleBatchChangeRole} loading={batchLoading}>Сменить роль</Button>
              </div>
            )}
          </div>
          <div className="space-y-2">
            {users.map((u: any) => (
              <div key={u.id} className="flex items-center justify-between border-b pb-2">
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={selectedUserIds.has(u.id)} onChange={() => toggleUserSelection(u.id)} className="rounded" />
                  <div>
                    <span className="font-medium">{u.name}</span> ({u.phone}) – {u.role}
                    <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${u.isApproved ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>{u.isApproved ? 'Подтверждён' : 'Ожидает'}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <select value={u.role} onChange={(e) => handleChangeRole(u.id, e.target.value)} className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-700">
                    <option value="BUYER">BUYER</option>
                    <option value="SELLER">SELLER</option>
                    <option value="MODERATOR">MODERATOR</option>
                    <option value="ADMIN">ADMIN</option>
                  </select>
                  <Button variant="ghost" size="sm" onClick={handleExportCSV} loading={exporting}>CSV</Button>
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

      {/* Продавцы */}
      {activeTab === 'Продавцы' && (
        <Card>
          <h2 className="text-xl font-bold mb-4">Статистика продавцов</h2>
          <div className="space-y-2">
            {sellers.map((s: any) => (
              <div key={s.id} className="flex items-center justify-between border-b pb-2">
                <div>
                  <span className="font-medium">{s.name}</span>
                  <span className="ml-2 text-sm text-gray-500">{s.phone}</span>
                </div>
                <div className="flex gap-4 text-sm">
                  <span>Товаров: <strong>{s.productsCount}</strong></span>
                  <span>Продаж: <strong>{s.ordersCount}</strong></span>
                  <span>Выручка: <strong className="text-green-600">{s.revenue.toLocaleString()} ₽</strong></span>
                </div>
              </div>
            ))}
            {sellers.length === 0 && <p className="text-center text-gray-500">Продавцов пока нет</p>}
          </div>
        </Card>
      )}

      {/* Инвайты */}
      {activeTab === 'Инвайты' && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">Инвайты</h2>
            <div className="flex gap-2 items-end">
              <Input
                placeholder="Код (оставьте пустым для автогенерации)"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                className="max-w-xs"
              />
              <Button
                variant="primary"
                size="sm"
                onClick={async () => {
                  try {
                    const newInvite = await createInvite(inviteCode.trim() || undefined);
                    toast.success('Инвайт создан');
                    setInviteCode('');
                    loadInvites();
                  } catch (err) {
                    toast.error('Не удалось создать инвайт');
                  }
                }}
              >
                Сгенерировать
              </Button>
            </div>
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
                <div className="flex gap-2 items-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(inv.code);
                      toast.success('Код скопирован');
                    }}
                  >
                    Копировать
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-500"
                    onClick={() => handleDeleteInvite(inv.code)}
                  >
                    Удалить
                  </Button>
                </div>
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
          <div className="flex flex-wrap gap-2 mb-4 items-center">
            <Input placeholder="Поиск по ID заказа..." value={transOrderSearch} onChange={e => setTransOrderSearch(e.target.value)} className="max-w-xs" />
            <select value={transTypeFilter} onChange={e => { setTransTypeFilter(e.target.value); setTransPage(1); }} className="px-3 py-2 rounded-xl bg-gray-100 dark:bg-gray-800 border border-transparent focus:border-blue-500 outline-none text-sm">
              <option value="">Все типы</option>
              <option value="payment">Оплата</option>
              <option value="payout_platform">Комиссия платформы</option>
              <option value="payout_seller">Продавцу</option>
              <option value="payout_referral">Рефералу</option>
            </select>
            <Button size="sm" onClick={() => setTransPage(1)}>Применить</Button>
          </div>
          <div className="space-y-2">
            {transactions.map((t: any) => (
              <div key={t.id} className="flex items-center justify-between border-b pb-2">
                <div><p className="font-medium text-sm">{t.type}</p><p className="text-xs text-gray-500">Заказ: {t.order?.id?.slice(0, 8)}... | Сумма: {t.amount.toLocaleString()} ₽</p></div>
                <div className="text-right"><span className={`text-xs px-2 py-0.5 rounded-full ${t.status === 'success' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>{t.status}</span><p className="text-xs text-gray-400 mt-1">{format(new Date(t.createdAt), 'dd MMM HH:mm', { locale: ru })}</p></div>
              </div>
            ))}
            {transactions.length === 0 && <p className="text-center text-gray-500">Транзакций не найдено</p>}
          </div>
          <div className="flex justify-between mt-4">
            <Button disabled={transPage <= 1} onClick={() => setTransPage(p => p - 1)}>Назад</Button>
            <span>Страница {transPage}</span>
            <Button onClick={() => setTransPage(p => p + 1)}>Вперед</Button>
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
                <div><p className="font-medium">{w.amount.toLocaleString()} ₽</p><p className="text-sm text-gray-500">{w.user?.name} ({w.user?.phone}) &nbsp;{w.createdAt && format(new Date(w.createdAt), 'dd MMM HH:mm', { locale: ru })}</p><span className={`text-xs px-2 py-0.5 rounded-full ${withdrawalStatusColor(w.status)}`}>{statusMap[w.status] || w.status}</span></div>
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

      {/* Логи */}
      {activeTab === 'Логи' && (
        <Card>
          <h2 className="text-xl font-bold mb-4">Логи модерации</h2>
          <div className="space-y-2">
            {modLogs.map((log: any) => (
              <div key={log.id} className="text-sm border-b pb-1"><span className="font-medium">Msg ID:</span> {log.chatMsgId} | {log.reason} → <span className="text-red-500">{log.action}</span><span className="ml-2 text-xs text-gray-400">{format(new Date(log.createdAt), 'HH:mm dd MMM', { locale: ru })}</span></div>
            ))}
            {modLogs.length === 0 && <p className="text-center text-gray-500">Логов пока нет</p>}
          </div>
          <div className="flex justify-between mt-4">
            <Button disabled={modLogPage <= 1} onClick={() => setModLogPage(p => p - 1)}>Назад</Button>
            <span>Страница {modLogPage}</span>
            <Button onClick={() => setModLogPage(p => p + 1)}>Вперед</Button>
          </div>
        </Card>
      )}

      {/* Настройки */}
      {activeTab === 'Настройки' && (
        <Card>
          <h2 className="text-xl font-bold mb-4">Настройки комиссий</h2>
          <div className="grid grid-cols-2 gap-4">
            <div><label>Комиссия платформы (%)</label><Input value={settings.platform_fee_percent || ''} onChange={e => setSettings({...settings, platform_fee_percent: e.target.value})} onBlur={() => updateSetting('platform_fee_percent', settings.platform_fee_percent)} /></div>
            <div><label>Реферальный процент (%)</label><Input value={settings.referral_percent || ''} onChange={e => setSettings({...settings, referral_percent: e.target.value})} onBlur={() => updateSetting('referral_percent', settings.referral_percent)} /></div>
          </div>
        </Card>
      )}

      {activeTab === 'Рассылка' && (
        <Card>
          <h2 className="text-xl font-bold mb-4">Массовая рассылка уведомлений</h2>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.target as HTMLFormElement;
              const message = (form.elements.namedItem('message') as HTMLTextAreaElement).value;
              const role = (form.elements.namedItem('role') as HTMLSelectElement).value;
              try {
                await api.post('/notifications/broadcast', { message, role: role || undefined });
                toast.success('Рассылка отправлена');
                form.reset();
              } catch (err) {
                toast.error('Ошибка при отправке');
              }
            }}
            className="space-y-4"
          >
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Текст уведомления</label>
              <textarea
                name="message"
                rows={3}
                required
                className="w-full px-4 py-3 rounded-xl bg-gray-100 dark:bg-gray-800 border border-transparent focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
                placeholder="Введите текст уведомления..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Кому отправить</label>
              <select
                name="role"
                className="px-4 py-3 rounded-xl bg-gray-100 dark:bg-gray-800 border border-transparent focus:border-blue-500 outline-none w-full"
              >
                <option value="">Всем пользователям</option>
                <option value="BUYER">Только покупателям</option>
                <option value="SELLER">Только продавцам</option>
              </select>
            </div>
            <Button type="submit" variant="primary" className="w-full">Отправить</Button>
          </form>
        </Card>
      )}

      {/* Модальное окно редактирования товара */}
      {editProduct && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">Редактировать товар</h3>
              <button onClick={() => setEditProduct(null)} className="p-1 text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <Input label="Название" value={editForm.title} onChange={e => setEditForm({ ...editForm, title: e.target.value })} />
            <Input label="Описание" value={editForm.description} onChange={e => setEditForm({ ...editForm, description: e.target.value })} />
            <Input label="Цена (₽)" type="number" value={editForm.price} onChange={e => setEditForm({ ...editForm, price: e.target.value })} />
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setEditProduct(null)}>Отмена</Button>
              <Button variant="primary" loading={editLoading} onClick={handleSaveProduct}>Сохранить</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}