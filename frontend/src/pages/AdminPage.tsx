import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import api from '../api/axios';
import { getInvites, createInvite, deleteInvite } from '../api/invites';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Users, ShoppingBag, Newspaper, Wallet, TrendingUp, Download, Plus, Trash2, Copy, Check, Settings, Loader2 } from 'lucide-react';
import { formatPhone } from '../utils/phone';
import { formatPrice } from "../utils/format";
import { resolveMedia } from '../utils/media';
import { mergeUniqueById } from '../utils/mergeUnique';
import type {
  ApiAdminDashboard,
  ApiInvite,
  ApiPost,
  ApiProduct,
  ApiSettings,
  ApiTransaction,
  ApiUser,
  ApiWithdrawal,
  UserRole,
} from '../api/types';

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

/** Post в админке приходит с relation author — берём это из ApiPost. */
type AdminPost = ApiPost & { author?: { id: string; name?: string | null } | null };

/**
 * L2: размер страницы админских списков.
 *
 * Бэкенд отдаёт `page/pages` (кроме выводов и инвайтов — те массивы), потолок
 * 100. Было: админка дёргала список БЕЗ параметров, то есть получала дефолт 20
 * записей, и остального админ не видел вообще — пагинации в UI не было.
 * Стало: постраничная догрузка кнопкой «Показать ещё» (для таблицы это проще и
 * надёжнее infinite scroll).
 */
const ADMIN_PAGE_SIZE = 100;

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [dashboard, setDashboard] = useState<ApiAdminDashboard | null>(null);
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [products, setProducts] = useState<ApiProduct[]>([]);
  const [posts, setPosts] = useState<AdminPost[]>([]);
  const [invites, setInvites] = useState<ApiInvite[]>([]);
  const [transactions, setTransactions] = useState<ApiTransaction[]>([]);
  const [withdrawals, setWithdrawals] = useState<ApiWithdrawal[]>([]);
  const [settings, setSettings] = useState<ApiSettings>({});
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState('');

  useEffect(() => { api.get<ApiAdminDashboard>('/admin/dashboard').then(r => setDashboard(r.data)).catch(() => {}); }, []);

  /**
   * Загрузка страницы активной вкладки.
   *
   * `reset=true` — смена вкладки/поиска: список заменяется и нумеруется заново.
   * `reset=false` — «Показать ещё»: страница добавляется к уже показанному.
   * Ответы бывают двух форм: `{ items, total, page, pages }` (юзеры, товары,
   * посты, транзакции) и просто массив (выводы, инвайты) — обрабатываем обе.
   */
  const loadTab = async (tab: string, pageNum: number, q: string, reset: boolean) => {
    if (reset) setLoading(true);
    else setLoadingMore(true);

    const qs = new URLSearchParams();
    if (q) qs.set('search', q);
    qs.set('page', String(pageNum));
    qs.set('limit', String(ADMIN_PAGE_SIZE));
    const suffix = `?${qs.toString()}`;

    const apply = <T extends { id: string }>(rows: T[], pages: number | null, setter: Dispatch<SetStateAction<T[]>>) => {
      if (reset) setter(rows);
      else setter((prev) => mergeUniqueById(prev, rows));
      setPage(pageNum + 1);
      // pages известен только у «страничных» ответов; у массивов — эвристика
      // по длине страницы (полная страница ⇒ возможно есть следующая).
      setHasMore(pages !== null ? pageNum < pages : rows.length === ADMIN_PAGE_SIZE);
    };

    try {
      switch (tab) {
        case 'users': {
          const r = await api.get<{ items: ApiUser[]; pages?: number }>(`/users${suffix}`);
          apply(r.data.items || [], r.data.pages ?? null, (v) => setUsers(v));
          break;
        }
        case 'products': {
          const r = await api.get<{ items: ApiProduct[]; pages?: number }>(`/products/admin/list${suffix}`);
          apply(r.data.items || [], r.data.pages ?? null, (v) => setProducts(v));
          break;
        }
        case 'posts': {
          const r = await api.get<{ items: AdminPost[]; pages?: number }>(`/posts/admin/list${suffix}`);
          apply(r.data.items || [], r.data.pages ?? null, (v) => setPosts(v));
          break;
        }
        case 'transactions': {
          const r = await api.get<{ items: ApiTransaction[]; pages?: number }>(`/payments/transactions${suffix}`);
          apply(r.data.items || [], r.data.pages ?? null, (v) => setTransactions(v));
          break;
        }
        case 'withdrawals': {
          const r = await api.get<ApiWithdrawal[]>(`/users/admin/withdrawals${suffix}`);
          apply(Array.isArray(r.data) ? r.data : [], null, (v) => setWithdrawals(v));
          break;
        }
        case 'invites': {
          const r = await getInvites({ page: pageNum, limit: ADMIN_PAGE_SIZE });
          const rows = Array.isArray(r) ? r : [];
          // У инвайта нет поля id — ключ это `code`, и он же уникален.
          if (reset) setInvites(rows);
          else setInvites(prev => {
            const seen = new Set(prev.map(i => i.code));
            return [...prev, ...rows.filter(i => !seen.has(i.code))];
          });
          setPage(pageNum + 1);
          setHasMore(rows.length === ADMIN_PAGE_SIZE);
          break;
        }
        case 'settings': {
          const r = await api.get<ApiSettings>('/settings');
          setSettings(r.data || {});
          setHasMore(false);
          break;
        }
        default:
          setHasMore(false);
      }
    } catch {
      if (reset) toast.error('Не удалось загрузить список');
      setHasMore(false);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'dashboard') return;
    // Пагинация и загрузка — внутри async IIFE: синхронный setState в теле
    // эффекта (setLoading внутри loadTab) давал каскадный рендер на каждый вход.
    (async () => {
      setPage(1);
      await loadTab(activeTab, 1, search, true);
    })();
    // loadTab намеренно не в зависимостях: функция пересоздаётся каждый рендер,
    // а эффект должен срабатывать только на смену вкладки/поиска.
  }, [activeTab, search]);

  const handleLoadMore = () => {
    if (loading || loadingMore) return;
    void loadTab(activeTab, page, search, false);
  };

  const handleCreateInvite = async () => { try { const r = await createInvite(); setInvites(prev => [r, ...prev]); toast.success('Инвайт создан'); } catch { toast.error('Ошибка'); } };
  const handleDeleteInvite = async (code: string) => { try { await deleteInvite(code); setInvites(prev => prev.filter(i => i.code !== code)); toast.success('Удалён'); } catch { toast.error('Ошибка'); } };
  const handleCopyInvite = (code: string) => { navigator.clipboard.writeText(code); setCopied(code); toast.success('Скопировано!'); setTimeout(() => setCopied(''), 2000); };
  const handleChangeRole = async (userId: string, role: UserRole) => { try { await api.patch(`/users/${userId}/role`, { role }); setUsers(prev => prev.map(u => u.id === userId ? { ...u, role } : u)); toast.success('Роль изменена'); } catch { toast.error('Ошибка'); } };
  const handleToggleProduct = async (id: string) => { try { await api.patch(`/products/${id}/toggle-active`); setProducts(prev => prev.map(p => p.id === id ? { ...p, isActive: !p.isActive } : p)); } catch { toast.error('Ошибка'); } };
  const handleTogglePost = async (id: string) => { try { await api.patch(`/posts/${id}/toggle-visibility`); setPosts(prev => prev.map(p => p.id === id ? { ...p, isHidden: !p.isHidden } : p)); } catch { toast.error('Ошибка'); } };
  const handleApproveWithdrawal = async (id: string) => { try { await api.patch(`/users/admin/withdrawals/${id}/approve`); setWithdrawals(prev => prev.map(w => w.id === id ? { ...w, status: 'approved' } : w)); } catch { toast.error('Ошибка'); } };
  const handleRejectWithdrawal = async (id: string) => { try { await api.patch(`/users/admin/withdrawals/${id}/reject`); setWithdrawals(prev => prev.map(w => w.id === id ? { ...w, status: 'rejected' } : w)); } catch { toast.error('Ошибка'); } };
  const handleUpdateSetting = async (key: string, value: string) => { try { await api.put('/settings', { key, value }); setSettings((prev) => ({ ...prev, [key]: value })); toast.success('Сохранено'); } catch { toast.error('Ошибка'); } };

  const renderDashboard = () => (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      {[
        { label: 'Пользователи', value: dashboard?.usersCount || 0, icon: <Users size={22} />, color: 'from-[#22c55e] to-[#16a34a]' },
        { label: 'Товары', value: dashboard?.productsCount || 0, icon: <ShoppingBag size={22} />, color: 'from-[#34d399] to-[#22c55e]' },
        { label: 'Заказы', value: dashboard?.ordersCount || 0, icon: <Wallet size={22} />, color: 'from-[#22c55e] to-[#34d399]' },
        { label: 'Доход', value: formatPrice(dashboard?.totalRevenue || 0), icon: <TrendingUp size={22} />, color: 'from-[#22c55e] to-[#16a34a]' },
      ].map((s, i) => (
        <div key={i} className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] p-5">
          <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${s.color} flex items-center justify-center text-[#0d1512] mb-3`}>{s.icon}</div>
          <div className="text-2xl font-bold text-[var(--color-text)]">{s.value}</div>
          <div className="text-sm text-[var(--color-muted)] mt-1">{s.label}</div>
        </div>
      ))}
    </div>
  );

  const renderUsers = () => (
    <div className="space-y-2">
      {users.map((u) => (
        <div key={u.id} className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#22c55e] to-[#34d399] text-[#0d1512] text-xs font-bold flex items-center justify-center">{(u.name || '?')[0].toUpperCase()}</div>
            <div>
              <p className="text-sm font-semibold text-[var(--color-text)]">{u.name || 'Без имени'}</p>
              <p className="text-xs text-[var(--color-muted)]">{formatPhone(u.phone)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-1 rounded-full text-[10px] font-semibold ${u.role === 'ADMIN' ? 'bg-red-400/10 text-red-400' : u.role === 'SELLER' ? 'bg-[#22c55e]/10 text-[#22c55e]' : 'bg-white/[0.04] text-[var(--color-muted)]'}`}>{u.role}</span>
            <select value={u.role} onChange={e => handleChangeRole(u.id, e.target.value as UserRole)} className="bg-[rgba(255,255,255,0.04)] border border-[var(--color-border)] rounded-lg px-2 py-1 text-xs text-[var(--color-text)] outline-none">
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
      {products.map((p) => (
        <div key={p.id} className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-[rgba(255,255,255,0.03)] border border-[var(--color-border)] overflow-hidden shrink-0">{p.media?.[0] && <img src={resolveMedia(p.media[0])} alt="" width={48} height={48} loading="lazy" decoding="async" className="w-full h-full object-cover" />}</div>
            <div>
              <p className="text-sm font-semibold text-[var(--color-text)]">{p.title}</p>
              <p className="text-xs text-[var(--color-muted)]">{p.seller?.name} • {formatPrice(p.price)}</p>
            </div>
          </div>
          <button onClick={() => handleToggleProduct(p.id)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${p.isActive ? 'bg-[#22c55e]/10 text-[#22c55e] hover:bg-[#22c55e]/20' : 'bg-red-400/10 text-red-400 hover:bg-red-400/20'}`}>{p.isActive ? 'Активен' : 'Скрыт'}</button>
        </div>
      ))}
    </div>
  );

  const renderPosts = () => (
    <div className="space-y-2">
      {posts.map((p) => (
        <div key={p.id} className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] p-4 flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[var(--color-text)] truncate">{p.title}</p>
            <p className="text-xs text-[var(--color-muted)]">{p.author?.name} • {p.isAd ? 'Реклама' : 'Пост'} • {p.createdAt ? format(new Date(p.createdAt), 'd MMM', { locale: ru }) : ''}</p>
          </div>
          <button onClick={() => handleTogglePost(p.id)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0 ml-3 ${p.isHidden ? 'bg-red-400/10 text-red-400 hover:bg-red-400/20' : 'bg-[#22c55e]/10 text-[#22c55e] hover:bg-[#22c55e]/20'}`}>{p.isHidden ? 'Скрыт' : 'Виден'}</button>
        </div>
      ))}
    </div>
  );

  const renderInvites = () => (
    <div>
      <button onClick={handleCreateInvite} className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-[#22c55e] text-[#0d1512] text-sm font-bold hover:bg-[#16a34a] transition-all shadow-[0_8px_32px_-8px_rgba(34,197,94,0.5)] mb-4"><Plus size={15} /> Создать инвайт</button>
      <div className="space-y-2">
        {invites.map((inv) => (
          <div key={inv.code} className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <code className="text-sm font-mono font-bold text-[#22c55e] bg-[#22c55e]/5 px-3 py-1.5 rounded-lg">{inv.code}</code>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${inv.isUsed ? 'bg-red-400/10 text-red-400' : 'bg-[#22c55e]/10 text-[#22c55e]'}`}>{inv.isUsed ? 'Использован' : 'Свободен'}</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => handleCopyInvite(inv.code)} className="p-2 rounded-lg text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-white/[0.06] transition-all">{copied === inv.code ? <Check size={15} className="text-[#22c55e]" /> : <Copy size={15} />}</button>
              <button onClick={() => handleDeleteInvite(inv.code)} className="p-2 rounded-lg text-[var(--color-muted)] hover:text-red-400 hover:bg-red-400/5 transition-all"><Trash2 size={15} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderTransactions = () => (
    <div className="space-y-2">
      {transactions.map((t) => (
        <div key={t.id} className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-[var(--color-text)]">{t.type}</p>
            <p className="text-xs text-[var(--color-muted)]">{t.orderId?.slice(0, 8)} • {t.createdAt ? format(new Date(t.createdAt), 'd MMM, HH:mm', { locale: ru }) : ''}</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-bold text-[var(--color-text)]">{formatPrice(t.amount)}</p>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${t.status === 'CONFIRMED' ? 'bg-[#22c55e]/10 text-[#22c55e]' : 'bg-amber-400/10 text-amber-400'}`}>{t.status}</span>
          </div>
        </div>
      ))}
    </div>
  );

  const renderWithdrawals = () => (
    <div className="space-y-2">
      {withdrawals.map((w) => (
        <div key={w.id} className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-[var(--color-text)]">{formatPrice(w.amount)}</p>
            <p className="text-xs text-[var(--color-muted)]">{w.userId?.slice(0, 8)} • {w.createdAt ? format(new Date(w.createdAt), 'd MMM, HH:mm', { locale: ru }) : ''}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-semibold px-2.5 py-0.5 rounded-full ${w.status === 'approved' ? 'bg-[#22c55e]/10 text-[#22c55e]' : w.status === 'rejected' ? 'bg-red-400/10 text-red-400' : 'bg-amber-400/10 text-amber-400'}`}>{statusMap[w.status] || w.status}</span>
            {w.status === 'pending' && (
              <div className="flex gap-1">
                <button onClick={() => handleApproveWithdrawal(w.id)} className="px-2.5 py-1 rounded-lg bg-[#22c55e]/10 text-[#22c55e] text-xs font-semibold hover:bg-[#22c55e]/20 transition-all">Одобрить</button>
                <button onClick={() => handleRejectWithdrawal(w.id)} className="px-2.5 py-1 rounded-lg bg-red-400/10 text-red-400 text-xs font-semibold hover:bg-red-400/20 transition-all">Отклонить</button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );

  /**
   * N1: поля настроек админки. Раньше здесь было 4 записи, а `deposit_tolerance_percent`,
   * `order_payment_ttl_minutes`, `escrow_ship_deadline_days`, `escrow_autocomplete_days`
   * и `withdrawal_min_amount` код читал, но поменять их было нельзя (ни UI, ни API).
   * Значения подтягиваются из `settings[f.key]` (GET /settings), сохранение — общий
   * `handleUpdateSetting` → PUT /settings.
   */
  const SETTINGS_FIELDS = [
    { key: 'platform_fee_percent', label: 'Комиссия платформы (%)', placeholder: '10' },
    { key: 'referral_percent', label: 'Реферальный процент (%)', placeholder: '5' },
    { key: 'ad_price', label: 'Цена рекламы (USDT/день)', placeholder: '5000' },
    { key: 'deposit_tolerance_percent', label: 'Допуск недоплаты (%)', placeholder: '1' },
    { key: 'order_payment_ttl_minutes', label: 'Срок оплаты заказа (мин)', placeholder: '15' },
    { key: 'escrow_ship_deadline_days', label: 'Срок отправки продавцом (дней)', placeholder: '5' },
    { key: 'escrow_autocomplete_days', label: 'Авто-завершение заказа (дней)', placeholder: '7' },
    { key: 'withdrawal_min_amount', label: 'Минимальная сумма вывода (USDT)', placeholder: '0' },
    { key: 'stop_words', label: 'Стоп-слова (через запятую)', placeholder: 'спам, casino' },
  ];

  const renderSettings = () => (
    <div className="space-y-4 max-w-md">
      {SETTINGS_FIELDS.map(f => {
        const val = settings[f.key] || '';
        return (
          <div key={f.key}>
            <label className="block text-sm font-medium text-[var(--color-muted)] mb-1.5">{f.label}</label>
            <div className="flex gap-2">
              <input value={val} onChange={e => setSettings((prev) => ({ ...prev, [f.key]: e.target.value }))} placeholder={f.placeholder} className="flex-1 px-4 py-2.5 rounded-xl bg-[rgba(255,255,255,0.04)] border border-[var(--color-border)] text-[var(--color-text)] text-sm placeholder:text-[var(--color-faint)] outline-none focus:border-[#22c55e]/50 transition-all" />
              <button onClick={() => handleUpdateSetting(f.key, val)} className="px-4 py-2.5 rounded-full bg-[#22c55e] text-[#0d1512] text-sm font-bold hover:bg-[#16a34a] transition-all shadow-[0_8px_32px_-8px_rgba(34,197,94,0.5)]">Сохранить</button>
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

  /**
   * L2: «Показать ещё» под таблицей активной вкладки.
   *
   * `hasMore` бэкенд отдаёт явно (`page < pages`) для юзеров/товаров/постов/
   * транзакций; для выводов и инвайтов (ответ — массив) — эвристика по длине
   * страницы. Настройки и дашборд не пагинируются.
   */
  const renderLoadMore = () => {
    if (activeTab === 'dashboard' || activeTab === 'settings') return null;
    return (
      <div className="mt-4 flex flex-col items-center gap-2">
        {loadingMore && <Loader2 size={20} className="animate-spin text-[#22c55e]" />}
        {!loadingMore && hasMore && (
          <button
            type="button"
            onClick={handleLoadMore}
            className="px-5 min-h-[44px] rounded-full bg-[var(--bg-3)] border border-[var(--color-border)] text-[var(--color-text)] text-sm font-semibold hover:border-[#22c55e]/40 transition-all"
          >
            Показать ещё
          </button>
        )}
        {!loadingMore && !hasMore && <span className="text-[var(--color-faint)] text-xs">Всё показали</span>}
      </div>
    );
  };

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div className="fixed inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 60% 40% at 50% -5%, rgba(34,197,94,0.10) 0%, transparent 60%)'
      }} />

      <div className="relative max-w-5xl mx-auto px-4 sm:px-6 pt-10 pb-20">
        <h1 className="text-2xl font-bold text-[var(--color-text)] mb-1">Админка</h1>
        <div className="mb-6" />

        {/* Tab pills */}
        <div className="flex items-center gap-1.5 mb-8 overflow-x-auto pb-1 no-scrollbar">
          {tabs.map(tab => (
            <button key={tab.key} onClick={() => { setActiveTab(tab.key); setSearch(''); }}
              className={`flex items-center gap-2 px-4 min-h-[44px] rounded-full text-sm font-semibold transition-all whitespace-nowrap ${
                activeTab === tab.key ? 'bg-[#22c55e] text-[#0d1512] shadow-[0_8px_32px_-8px_rgba(34,197,94,0.5)]' : 'text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-white/[0.06]'
              }`}>{tab.icon}{tab.label}</button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-16" />)}</div>
        ) : (
          <>
            {renderContent()}
            {renderLoadMore()}
          </>
        )}
      </div>
    </div>
  );
}