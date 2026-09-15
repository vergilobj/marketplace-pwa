import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import api from '../api/axios';
import { getInvites, createInvite, deleteInvite } from '../api/invites';
import toast from 'react-hot-toast';
import { Users, ShoppingBag, Newspaper, Wallet, TrendingUp, Download, Plus, Trash2, Copy, Check, Settings, Loader2, MessageSquare, BookOpen } from 'lucide-react';
import { formatPhone } from '../utils/phone';
import { formatPrice, formatDate } from "../utils/format";
import { errorMessage } from '../utils/error';
import { resolveMedia } from '../utils/media';
import { mergeUniqueById } from '../utils/mergeUnique';
import KnowledgeTab from './admin/KnowledgeTab';
import AdminFeedbackPanel, { type AdminFeedbackListItem } from './admin/AdminFeedbackPanel';
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
  // B4 §6: «Инвайты»/«База знаний» — жаргон, владелец проекта их не понимал.
  // Ключи вкладок (`invites`, `knowledge`) — часть внутреннего контракта
  // (`activeTab`, switch в renderContent) и остаются как есть.
  { key: 'invites', label: 'Приглашения', icon: <Plus size={15} /> },
  { key: 'transactions', label: 'Транзакции', icon: <Wallet size={15} /> },
  { key: 'withdrawals', label: 'Выводы', icon: <Download size={15} /> },
  { key: 'feedback', label: 'Обратная связь', icon: <MessageSquare size={15} /> },
  { key: 'knowledge', label: 'Ответы', icon: <BookOpen size={15} /> },
  { key: 'settings', label: 'Настройки', icon: <Settings size={15} /> },
];

/**
 * Обращение из `GET /admin/feedback`. Форма ответа — `{ items, total, page,
 * limit }` (как у остальных админ-списков), `user` приходит урезанным select'ом.
 *
 * ЭТАП 4 §4.6: тип переиспользуется двухпанельным тредом
 * (`admin/AdminFeedbackPanel.tsx`) — единый источник правды по полям.
 */
export type AdminFeedback = AdminFeedbackListItem;

/**
 * Фильтры треда обращений (§4.3: у треда шесть статусов, а не три).
 *
 * Было: NEW / IN_PROGRESS / CLOSED — жизненный цикл из одной строки. Стало:
 * появляются WAITING_ADMIN / WAITING_USER / AI_HANDLED, и админу нужен фильтр
 * «Ждёт админа» — иначе очередь не видно.
 */
const FEEDBACK_STATUS_FILTERS: Array<{ key: string; label: string }> = [
  { key: 'WAITING_ADMIN', label: 'Ждёт админа' },
  { key: 'NEW', label: 'Новые' },
  { key: 'IN_PROGRESS', label: 'В работе' },
  { key: 'WAITING_USER', label: 'Ждём юзера' },
  { key: 'AI_HANDLED', label: 'Ответил ИИ' },
  { key: 'CLOSED', label: 'Закрыто' },
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
  const [feedbacks, setFeedbacks] = useState<AdminFeedback[]>([]);
  const [feedbackStatus, setFeedbackStatus] = useState('');
  /** Открытый тред в двухпанельном виде (§4.6) — id выбранного обращения. */
  const [activeFeedbackId, setActiveFeedbackId] = useState<string | null>(null);
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
  const loadTab = async (tab: string, pageNum: number, q: string, reset: boolean, statusFilter = '') => {
    if (reset) setLoading(true);
    else setLoadingMore(true);

    const qs = new URLSearchParams();
    if (q) qs.set('search', q);
    qs.set('page', String(pageNum));
    qs.set('limit', String(ADMIN_PAGE_SIZE));
    const suffix = `?${qs.toString()}`;

    // Обращения фильтруются по статусу — отдельный querystring (`search`
    // бэкенд тут не поддерживает).
    const feedbackQs = new URLSearchParams();
    if (statusFilter) feedbackQs.set('status', statusFilter);
    feedbackQs.set('page', String(pageNum));
    feedbackQs.set('limit', String(ADMIN_PAGE_SIZE));
    const feedbackSuffix = `?${feedbackQs.toString()}`;

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
        case 'feedback': {
          const r = await api.get<{ items: AdminFeedback[]; pages?: number }>(
            `/admin/feedback${feedbackSuffix}`,
          );
          apply(r.data.items || [], r.data.pages ?? null, (v) => setFeedbacks(v));
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
      await loadTab(activeTab, 1, search, true, feedbackStatus);
    })();
    // loadTab намеренно не в зависимостях: функция пересоздаётся каждый рендер,
    // а эффект должен срабатывать только на смену вкладки/поиска/фильтра.
  }, [activeTab, search, feedbackStatus]);

  const handleLoadMore = () => {
    if (loading || loadingMore) return;
    void loadTab(activeTab, page, search, false, feedbackStatus);
  };

  /**
   * B4 §1/§2: обработчики инвайтов.
   *
   * Было: `catch { toast.error('Ошибка') }` — юзер не знал ни что случилось,
   * ни что делать. Стало: `errorMessage(e, …)` (текст бэка / «нет связи» /
   * «слишком много попыток») плюс подсказка, что предпринять.
   */
  const handleCreateInvite = async () => {
    try {
      const r = await createInvite();
      setInvites(prev => [r, ...prev]);
      toast.success('Приглашение создано');
    } catch (e: unknown) {
      toast.error(errorMessage(e, 'Не удалось создать приглашение — попробуй ещё раз'));
    }
  };
  const handleDeleteInvite = async (code: string) => {
    try {
      await deleteInvite(code);
      setInvites(prev => prev.filter(i => i.code !== code));
      toast.success('Приглашение удалено');
    } catch (e: unknown) {
      toast.error(errorMessage(e, 'Не удалось удалить приглашение — обнови страницу'));
    }
  };
  const handleCopyInvite = (code: string) => { navigator.clipboard.writeText(code); setCopied(code); toast.success('Код скопирован'); setTimeout(() => setCopied(''), 2000); };
  const handleChangeRole = async (userId: string, role: UserRole) => { try { await api.patch(`/users/${userId}/role`, { role }); setUsers(prev => prev.map(u => u.id === userId ? { ...u, role } : u)); toast.success(`Роль изменена на ${role}`); } catch (e: unknown) { toast.error(errorMessage(e, 'Не удалось сменить роль — попробуй ещё раз')); } };

  /**
   * B4 §2: скрытие/показ товара.
   *
   * Было: ноль обратной связи (только цвет кнопки). Стало: тост с конкретикой
   * и текстом ошибки, если запрос упал (локальный стейт тогда НЕ трогаем —
   * UI не расходится с БД).
   */
  const handleToggleProduct = async (id: string) => {
    const current = products.find((p) => p.id === id);
    const willHide = current?.isActive ?? false;
    try {
      await api.patch(`/products/${id}/toggle-active`);
      setProducts(prev => prev.map(p => p.id === id ? { ...p, isActive: !p.isActive } : p));
      toast.success(willHide ? 'Товар скрыт из каталога' : 'Товар снова виден в каталоге');
    } catch (e: unknown) {
      toast.error(errorMessage(e, 'Не удалось изменить видимость товара — попробуй ещё раз'));
    }
  };
  const handleTogglePost = async (id: string) => {
    const current = posts.find((p) => p.id === id);
    const willHide = !(current?.isHidden ?? false);
    try {
      await api.patch(`/posts/${id}/toggle-visibility`);
      setPosts(prev => prev.map(p => p.id === id ? { ...p, isHidden: !p.isHidden } : p));
      toast.success(willHide ? 'Пост скрыт из ленты' : 'Пост снова виден в ленте');
    } catch (e: unknown) {
      toast.error(errorMessage(e, 'Не удалось изменить видимость поста — попробуй ещё раз'));
    }
  };

  /**
   * B4 §2: вывод средств. Одобрение/отклонение — денежное действие, а обратной
   * связи не было вообще: менялся только цвет бейджа в строке. Теперь админ
   * видит подтверждение (и сумму) либо причину отказа.
   */
  const handleApproveWithdrawal = async (id: string) => {
    try {
      await api.patch(`/users/admin/withdrawals/${id}/approve`);
      setWithdrawals(prev => prev.map(w => w.id === id ? { ...w, status: 'approved' } : w));
      toast.success('Вывод одобрен — средства отправлены на кошелёк');
    } catch (e: unknown) {
      toast.error(errorMessage(e, 'Не удалось одобрить вывод — заявка осталась на рассмотрении'));
    }
  };
  const handleRejectWithdrawal = async (id: string) => {
    try {
      await api.patch(`/users/admin/withdrawals/${id}/reject`);
      setWithdrawals(prev => prev.map(w => w.id === id ? { ...w, status: 'rejected' } : w));
      toast.success('Вывод отклонён — деньги вернулись на баланс юзера');
    } catch (e: unknown) {
      toast.error(errorMessage(e, 'Не удалось отклонить вывод — заявка осталась на рассмотрении'));
    }
  };
  const handleUpdateSetting = async (key: string, value: string) => {
    const label = SETTINGS_FIELDS.find(f => f.key === key)?.label ?? key;
    try {
      await api.put('/settings', { key, value });
      setSettings((prev) => ({ ...prev, [key]: value }));
      toast.success(`Настройка сохранена: ${label}`);
    } catch (e: unknown) {
      toast.error(errorMessage(e, 'Не удалось сохранить настройку — значение не применено'));
    }
  };

  /**
   * Смена статуса обращения (§4.3).
   *
   * Раньше сюда же уезжала «Заметка админа» (плоское поле `adminNote`) — ЭТАП 4
   * заменил его на тред сообщений, поэтому здесь остаётся только статус, а сам
   * ответ админа уходит через `POST /admin/feedback/:id/messages` из
   * `AdminFeedbackPanel`. Локальный стейт обновляем ответом сервера — UI не
   * расходится с БД.
   */
  const handleUpdateFeedback = async (id: string, status?: string) => {
    if (!status) {
      toast.error('Статус не выбран — сначала выбери его в списке');
      return;
    }

    try {
      const r = await api.patch<AdminFeedback>(`/admin/feedback/${id}`, { status });
      setFeedbacks((prev) =>
        prev.map((f) => (f.id === id ? { ...f, ...(r.data ?? {}), status } : f)),
      );
      toast.success(`Статус обращения изменён: ${FEEDBACK_STATUS_FILTERS.find((s) => s.key === status)?.label ?? status}`);
    } catch (e: unknown) {
      toast.error(errorMessage(e, 'Не удалось изменить статус обращения — попробуй ещё раз'));
    }
  };

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
            <p className="text-xs text-[var(--color-muted)]">{p.author?.name} • {p.isAd ? 'Реклама' : 'Пост'} • {formatDate(p.createdAt, 'short')}</p>
          </div>
          <button onClick={() => handleTogglePost(p.id)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0 ml-3 ${p.isHidden ? 'bg-red-400/10 text-red-400 hover:bg-red-400/20' : 'bg-[#22c55e]/10 text-[#22c55e] hover:bg-[#22c55e]/20'}`}>{p.isHidden ? 'Скрыт' : 'Виден'}</button>
        </div>
      ))}
    </div>
  );

  const renderInvites = () => (
    <div>
      <button onClick={handleCreateInvite} className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-[#22c55e] text-[#0d1512] text-sm font-bold hover:bg-[#16a34a] transition-all shadow-[0_8px_32px_-8px_rgba(34,197,94,0.5)] mb-4"><Plus size={15} /> Создать приглашение</button>
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
            <p className="text-xs text-[var(--color-muted)]">{t.orderId?.slice(0, 8)} • {formatDate(t.createdAt, 'short')}</p>
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
            <p className="text-xs text-[var(--color-muted)]">{w.userId?.slice(0, 8)} • {formatDate(w.createdAt, 'short')}</p>
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

  /**
   * Таб «Обратная связь» (ЭТАП 4 §5, SPEC §4.6).
   *
   * Было: карточки со «Заметкой админа» (плоское поле `adminNote`).
   * Стало: двухпанельный тред — список слева, переписка справа. Ответы админа
   * уходят отдельным эндпоинтом `/admin/feedback/:id/messages`, а под ответом
   * появляется плашка «Сохранить как знание?» (ПУТЬ A §6.1).
   *
   * Панель вынесена в отдельный компонент: тред держит собственное состояние
   * (сообщения, кандидаты в знания, черновики), и держать это в AdminPage,
   * который и без того весит 600+ строк, было бы регрессом читаемости.
   */
  const renderFeedback = () => (
    <div>
      {/* Фильтр по статусу */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button
          type="button"
          onClick={() => setFeedbackStatus('')}
          className={`px-4 min-h-[44px] rounded-full text-sm font-semibold transition-all ${
            feedbackStatus === ''
              ? 'bg-[#22c55e] text-[#0d1512]'
              : 'bg-[var(--bg-3)] text-[var(--color-muted)] hover:text-[var(--color-text)]'
          }`}
        >
          Все
        </button>
        {FEEDBACK_STATUS_FILTERS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setFeedbackStatus(s.key)}
            className={`px-4 min-h-[44px] rounded-full text-sm font-semibold transition-all ${
              feedbackStatus === s.key
                ? 'bg-[#22c55e] text-[#0d1512]'
                : 'bg-[var(--bg-3)] text-[var(--color-muted)] hover:text-[var(--color-text)]'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <AdminFeedbackPanel
        items={feedbacks}
        activeId={activeFeedbackId}
        onSelect={setActiveFeedbackId}
        onChangeStatus={handleUpdateFeedback}
        onRefresh={async () => {
          await loadTab('feedback', 1, search, true, feedbackStatus);
        }}
      />
    </div>
  );

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
      case 'feedback': return renderFeedback();
      case 'knowledge': return <KnowledgeTab />;
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