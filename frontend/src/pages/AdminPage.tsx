import { useEffect, useState } from 'react';
import api from '../api/axios';
import { getInvites, createInvite, deleteInvite } from '../api/invites';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Users, ShoppingBag, Newspaper, Wallet, TrendingUp, Download, Plus, Trash2, Copy, Check, Settings, Search } from 'lucide-react';

const statusMap: Record<string, string> = { pending: 'На рассмотрении', approved: 'Одобрена', rejected: 'Отклонена' };

const tabs = [
  { key: 'dashboard', label: 'Дашборд', icon: <TrendingUp size={15} /> },
  { key: 'users', label: 'Пользователи', icon: <Users size={15} /> },
  { key: 'products', label: 'Товары', icon: <ShoppingBag size={15} /> },
  { key: 'posts', label: 'Посты', icon: <Newspaper size={15} /> },
  { key: 'invites', label: 'Инвайты', icon: <Plus size={15} /> },
  { key: 'transactions', label: 'Транзакции', icon: <Wallet size={15} /> },
  { key: 'withdrawals', label: 'Выводы', icon: <Download size={15} /> },
  { key: 'settings', label: 'Настройки', icon: <Settings size={15} /> },
];

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [dashboard, setDashboard] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [posts, setPosts] = useState<any[]>([]);
  const [invites, setInvites] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>({});
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState('');

  useEffect(() => { api.get('/admin/dashboard').then(r => setDashboard(r.data)).catch(() => {}); }, []);

  useEffect(() => {
    const q = search ? `?search=${search}` : '';
    switch (activeTab) {
      case 'users': api.get(`/users${q}`).then(r => setUsers(r.data.items || [])).finally(() => setLoading(false)); break;
      case 'products': api.get(`/products/admin/list${q}`).then(r => setProducts(r.data.items || [])).finally(() => setLoading(false)); break;
      case 'posts': api.get(`/posts/admin/list${q}`).then(r => setPosts(r.data.items || [])).finally(() => setLoading(false)); break;
      case 'invites': getInvites().then(setInvites).finally(() => setLoading(false)); break;
      case 'transactions': api.get(`/payments/transactions`).then(r => setTransactions(r.data.items || [])).finally(() => setLoading(false)); break;
      case 'withdrawals': api.get('/users/admin/withdrawals').then(r => setWithdrawals(r.data || [])).finally(() => setLoading(false)); break;
      case 'settings': api.get('/settings').then(r => setSettings(r.data || {})).finally(() => setLoading(false)); break;
      default: queueMicrotask(() => setLoading(false));
    }
  }, [activeTab, search]);

  const handleCreateInvite = async () => { try { const r = await createInvite(); setInvites(prev => [...prev, r.data]); toast.success('Инвайт создан'); } catch { toast.error('Ошибка'); } };
  const handleDeleteInvite = async (code: string) => { try { await deleteInvite(code); setInvites(prev => prev.filter(i => i.code !== code)); toast.success('Удалён'); } catch { toast.error('Ошибка'); } };
  const handleCopyInvite = (code: string) => { navigator.clipboard.writeText(code); setCopied(code); toast.success('Скопировано!'); setTimeout(() => setCopied(''), 2000); };
  const handleChangeRole = async (userId: string, role: string) => { try { await api.patch(`/users/${userId}/role`, { role }); setUsers(prev => prev.map(u => u.id === userId ? { ...u, role } : u)); toast.success('Роль изменена'); } catch { toast.error('Ошибка'); } };
  const handleToggleProduct = async (id: string) => { try { await api.patch(`/products/${id}/toggle-active`); setProducts(prev => prev.map(p => p.id === id ? { ...p, isActive: !p.isActive } : p)); } catch { toast.error('Ошибка'); } };
  const handleTogglePost = async (id: string) => { try { await api.patch(`/posts/${id}/toggle-visibility`); setPosts(prev => prev.map(p => p.id === id ? { ...p, isHidden: !p.isHidden } : p)); } catch { toast.error('Ошибка'); } };
  const handleApproveWithdrawal = async (id: string) => { try { await api.patch(`/users/admin/withdrawals/${id}/approve`); setWithdrawals(prev => prev.map(w => w.id === id ? { ...w, status: 'approved' } : w)); } catch { toast.error('Ошибка'); } };
  const handleRejectWithdrawal = async (id: string) => { try { await api.patch(`/users/admin/withdrawals/${id}/reject`); setWithdrawals(prev => prev.map(w => w.id === id ? { ...w, status: 'rejected' } : w)); } catch { toast.error('Ошибка'); } };
  const handleUpdateSetting = async (key: string, value: string) => { try { await api.put('/settings', { key, value }); setSettings((prev: any) => ({ ...prev, [key]: value })); toast.success('Сохранено'); } catch { toast.error('Ошибка'); } };

  const renderDashboard = () => (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      {[
        { label: 'Пользователи', value: dashboard?.usersCount || 0, icon: <Users size={22} />, color: 'from-indigo-500 to-blue-600' },
        { label: 'Товары', value: dashboard?.productsCount || 0, icon: <ShoppingBag size={22} />, color: 'from-emerald-500 to-teal-600' },
        { label: 'Заказы', value: dashboard?.ordersCount || 0, icon: <Wallet size={22} />, color: 'from-amber-500 to-orange-600' },
        { label: 'Доход', value: `${(dashboard?.totalRevenue || 0).toLocaleString('ru-RU')} USDT`, icon: <TrendingUp size={22} />, color: 'from-purple-500 to-blue-600' },
      ].map((s, i) => (
        <div key={i} className="glass-card rounded-2xl p-5">
          <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${s.color} flex items-center justify-center text-[var(--color-text)] mb-3`}>{s.icon}</div>
          <div className="text-2xl font-bold text-white">{s.value}</div>
          <div className="text-sm text-white/50 mt-1">{s.label}</div>
        </div>
      ))}
    </div>
  );

  const renderUsers = () => (
    <div className="space-y-2">
      {users.map((u: any) => (
        <div key={u.id} className="glass-card rounded-2xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-[var(--color-text)] text-xs font-bold flex items-center justify-center">{(u.name || '?')[0].toUpperCase()}</div>
            <div>
              <p className="text-sm font-semibold text-white">{u.name || 'Без имени'}</p>
              <p className="text-xs text-white/35">{u.phone}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-1 rounded-full text-[10px] font-semibold ${u.role === 'ADMIN' ? 'bg-red-400/10 text-red-400' : u.role === 'SELLER' ? 'bg-indigo-400/10 text-indigo-400' : 'bg-white/[0.04] text-white/50'}`}>{u.role}</span>
            <select value={u.role} onChange={e => handleChangeRole(u.id, e.target.value)} className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-1 text-xs text-white/70 outline-none">
              <option value="BUYER">BUYER</option>
              <option value="SELLER">SELLER</option>
              <option value="ADMIN">ADMIN</option>
            </select>
          </div>
        </div>
      ))}
    </div>
  );

  const renderProducts = () => (
    <div className="space-y-2">
      {products.map((p: any) => (
        <div key={p.id} className="glass-card rounded-2xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] overflow-hidden shrink-0">{p.media?.[0] && <img src={p.media[0]} alt="" className="w-full h-full object-cover" />}</div>
            <div>
              <p className="text-sm font-semibold text-white">{p.title}</p>
              <p className="text-xs text-white/35">{p.seller?.name} • {new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 0 }).format(p.price)}</p>
            </div>
          </div>
          <button onClick={() => handleToggleProduct(p.id)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${p.isActive ? 'bg-emerald-400/10 text-emerald-400 hover:bg-emerald-400/20' : 'bg-red-400/10 text-red-400 hover:bg-red-400/20'}`}>{p.isActive ? 'Активен' : 'Скрыт'}</button>
        </div>
      ))}
    </div>
  );

  const renderPosts = () => (
    <div className="space-y-2">
      {posts.map((p: any) => (
        <div key={p.id} className="glass-card rounded-2xl p-4 flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[var(--color-text)] truncate">{p.title}</p>
            <p className="text-xs text-white/35">{p.author?.name} • {p.isAd ? 'Реклама' : 'Пост'} • {p.createdAt ? format(new Date(p.createdAt), 'd MMM', { locale: ru }) : ''}</p>
          </div>
          <button onClick={() => handleTogglePost(p.id)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0 ml-3 ${p.isHidden ? 'bg-red-400/10 text-red-400 hover:bg-red-400/20' : 'bg-emerald-400/10 text-emerald-400 hover:bg-emerald-400/20'}`}>{p.isHidden ? 'Скрыт' : 'Виден'}</button>
        </div>
      ))}
    </div>
  );

  const renderInvites = () => (
    <div>
      <button onClick={handleCreateInvite} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-500 text-[var(--color-text)] text-sm font-semibold hover:bg-indigo-400 transition-all shadow-lg mb-4"><Plus size={15} /> Создать инвайт</button>
      <div className="space-y-2">
        {invites.map((inv: any) => (
          <div key={inv.code} className="glass-card rounded-2xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <code className="text-sm font-mono font-bold text-indigo-400 bg-indigo-400/5 px-3 py-1.5 rounded-lg">{inv.code}</code>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${inv.isUsed ? 'bg-red-400/10 text-red-400' : 'bg-emerald-400/10 text-emerald-400'}`}>{inv.isUsed ? 'Использован' : 'Свободен'}</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => handleCopyInvite(inv.code)} className="p-2 rounded-lg text-white/35 hover:text-[var(--color-text)] hover:bg-white/[0.06] transition-all">{copied === inv.code ? <Check size={15} className="text-emerald-400" /> : <Copy size={15} />}</button>
              <button onClick={() => handleDeleteInvite(inv.code)} className="p-2 rounded-lg text-white/35 hover:text-red-400 hover:bg-red-400/5 transition-all"><Trash2 size={15} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderTransactions = () => (
    <div className="space-y-2">
      {transactions.map((t: any) => (
        <div key={t.id} className="glass-card rounded-2xl p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-white">{t.type}</p>
            <p className="text-xs text-white/35">{t.orderId?.slice(0, 8)} • {t.createdAt ? format(new Date(t.createdAt), 'd MMM, HH:mm', { locale: ru }) : ''}</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-bold text-white">{t.amount?.toLocaleString('ru-RU')} USDT</p>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${t.status === 'success' ? 'bg-emerald-400/10 text-emerald-400' : 'bg-amber-400/10 text-amber-400'}`}>{t.status}</span>
          </div>
        </div>
      ))}
    </div>
  );

  const renderWithdrawals = () => (
    <div className="space-y-2">
      {withdrawals.map((w: any) => (
        <div key={w.id} className="glass-card rounded-2xl p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-white">{w.amount?.toLocaleString('ru-RU')} USDT</p>
            <p className="text-xs text-white/35">{w.userId?.slice(0, 8)} • {w.createdAt ? format(new Date(w.createdAt), 'd MMM, HH:mm', { locale: ru }) : ''}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-semibold px-2.5 py-0.5 rounded-full ${w.status === 'approved' ? 'bg-emerald-400/10 text-emerald-400' : w.status === 'rejected' ? 'bg-red-400/10 text-red-400' : 'bg-amber-400/10 text-amber-400'}`}>{statusMap[w.status] || w.status}</span>
            {w.status === 'pending' && (
              <div className="flex gap-1">
                <button onClick={() => handleApproveWithdrawal(w.id)} className="px-2.5 py-1 rounded-lg bg-emerald-400/10 text-emerald-400 text-xs font-semibold hover:bg-emerald-400/20 transition-all">Одобрить</button>
                <button onClick={() => handleRejectWithdrawal(w.id)} className="px-2.5 py-1 rounded-lg bg-red-400/10 text-red-400 text-xs font-semibold hover:bg-red-400/20 transition-all">Отклонить</button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );

  const renderSettings = () => (
    <div className="space-y-4 max-w-md">
      {[
        { key: 'platform_fee_percent', label: 'Комиссия платформы (%)', placeholder: '10' },
        { key: 'referral_percent', label: 'Реферальный процент (%)', placeholder: '5' },
        { key: 'ad_price', label: 'Цена рекламы (USDT/день)', placeholder: '5000' },
        { key: 'stop_words', label: 'Стоп-слова (через запятую)', placeholder: 'спам, casino' },
      ].map(f => {
        const val = settings[f.key] || '';
        return (
          <div key={f.key}>
            <label className="block text-sm font-medium text-white/60 mb-1.5">{f.label}</label>
            <div className="flex gap-2">
              <input value={val} onChange={e => setSettings((prev: any) => ({ ...prev, [f.key]: e.target.value }))} placeholder={f.placeholder} className="flex-1 px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-[var(--color-text)] text-sm placeholder:text-white/20 outline-none focus:border-indigo-500/50 transition-all" />
              <button onClick={() => handleUpdateSetting(f.key, val)} className="px-4 py-2.5 rounded-xl bg-indigo-500 text-[var(--color-text)] text-sm font-semibold hover:bg-indigo-400 transition-all shadow-lg">Сохранить</button>
            </div>
          </div>
        );
      })}
    </div>
  );

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard': return renderDashboard();
      case 'users': return renderUsers();
      case 'products': return renderProducts();
      case 'posts': return renderPosts();
      case 'invites': return renderInvites();
      case 'transactions': return renderTransactions();
      case 'withdrawals': return renderWithdrawals();
      case 'settings': return renderSettings();
      default: return null;
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)] mb-1">Админ-панель</h1>
          <p className="text-white/50 text-sm">Управление маркетплейсом</p>
        </div>
        {(activeTab === 'users' || activeTab === 'products' || activeTab === 'posts') && (
          <div className="relative">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/35" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск..." className="w-56 pl-10 pr-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-[var(--color-text)] placeholder:text-white/25 outline-none focus:border-indigo-500/50 transition-all" />
          </div>
        )}
      </div>

      {/* Tab pills */}
      <div className="flex items-center gap-1.5 mb-8 overflow-x-auto pb-1">
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => { setActiveTab(tab.key); setSearch(''); }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all whitespace-nowrap ${
              activeTab === tab.key ? 'bg-indigo-500 text-[var(--color-text)] shadow-lg shadow-indigo-500/25' : 'text-white/50 hover:text-[var(--color-text)] hover:bg-white/[0.06]'
            }`}>{tab.icon}{tab.label}</button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-16 rounded-2xl" />)}</div>
      ) : (
        renderContent()
      )}
    </div>
  );
}
