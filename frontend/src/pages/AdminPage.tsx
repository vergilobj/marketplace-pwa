import React, { useEffect, useState } from 'react';
import api from '../api/axios';
import Card from '../components/ui/Card';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import Tabs from '../components/ui/Tabs';
import toast from 'react-hot-toast';

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState('Посты');
  const [settings, setSettings] = useState<any>({});
  const [users, setUsers] = useState<any[]>([]);
  const [posts, setPosts] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);

  useEffect(() => {
    api.get('/settings').then(r => {
      const map: any = {};
      r.data.forEach((s: any) => (map[s.key] = s.value));
      setSettings(map);
    });
  }, []);

  const loadUsers = () => api.get('/users').then(r => setUsers(r.data));
  const loadPosts = () => api.get('/posts/admin/list').then(r => setPosts(r.data));
  const loadProducts = () => api.get('/products/admin/list').then(r => setProducts(r.data));

  useEffect(() => {
    if (activeTab === 'Пользователи') loadUsers();
    else if (activeTab === 'Посты') loadPosts();
    else if (activeTab === 'Товары') loadProducts();
  }, [activeTab]);

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
    await api.delete(`/products/${id}`);
    loadProducts();
  };

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Админ-панель</h1>
      <Tabs
        tabs={['Посты', 'Товары', 'Пользователи', 'Настройки']}
        active={activeTab}
        onChange={setActiveTab}
      />

      {activeTab === 'Посты' && (
        <Card>
          <h2 className="text-xl font-bold mb-4">Управление постами</h2>
          <div className="space-y-2">
            {posts.map((p: any) => (
              <div key={p.id} className="flex items-center justify-between border-b pb-2">
                <div>
                  <span className="font-medium">{p.title}</span>
                  <span className="ml-2 text-sm text-gray-500">
                    {p.isAd ? 'Реклама' : 'Обычный'}
                  </span>
                  <span
                    className={`ml-2 text-xs px-2 py-0.5 rounded-full ${
                      p.isHidden ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                    }`}
                  >
                    {p.isHidden ? 'Скрыт' : 'Активен'}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => togglePostVisibility(p.id)}>
                    {p.isHidden ? 'Показать' : 'Скрыть'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deletePost(p.id)}
                    className="text-red-500"
                  >
                    Удалить
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {activeTab === 'Товары' && (
        <Card>
          <h2 className="text-xl font-bold mb-4">Управление товарами</h2>
          <div className="space-y-2">
            {products.map((p: any) => (
              <div key={p.id} className="flex items-center justify-between border-b pb-2">
                <div>
                  <span className="font-medium">{p.title}</span>
                  <span className="ml-2 text-sm text-gray-500">{p.price} ₽</span>
                  <span
                    className={`ml-2 text-xs px-2 py-0.5 rounded-full ${
                      p.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {p.isActive ? 'Активен' : 'Скрыт'}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => toggleProductActive(p.id)}>
                    {p.isActive ? 'Скрыть' : 'Показать'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteProduct(p.id)}
                    className="text-red-500"
                  >
                    Удалить
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {activeTab === 'Пользователи' && (
        <Card>
          <h2 className="text-xl font-bold mb-4">Пользователи</h2>
          <div className="space-y-2">
            {users.map((u: any) => (
              <div key={u.id} className="flex justify-between items-center">
                <div>
                  <span className="font-medium">{u.name}</span> ({u.phone}) – {u.role}
                </div>
                <span
                  className={`text-xs px-2 py-1 rounded-full ${
                    u.isApproved ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                  }`}
                >
                  {u.isApproved ? 'Подтверждён' : 'Ожидает'}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {activeTab === 'Настройки' && (
        <Card>
          <h2 className="text-xl font-bold mb-4">Настройки комиссий</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label>Комиссия платформы (%)</label>
              <Input
                value={settings.platform_fee_percent || ''}
                onChange={e =>
                  setSettings({ ...settings, platform_fee_percent: e.target.value })
                }
                onBlur={() =>
                  updateSetting('platform_fee_percent', settings.platform_fee_percent)
                }
              />
            </div>
            <div>
              <label>Реферальный процент (%)</label>
              <Input
                value={settings.referral_percent || ''}
                onChange={e =>
                  setSettings({ ...settings, referral_percent: e.target.value })
                }
                onBlur={() =>
                  updateSetting('referral_percent', settings.referral_percent)
                }
              />
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}