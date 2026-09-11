import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { getProfile, updateProfile, getStats, becomeSeller, getBalance, type BalanceResponse } from '../api/users';
import { IMaskInput } from 'react-imask';
import { formatPhone, unformatPhone } from '../utils/phone';
import { formatPrice } from '../utils/format';
import { User, Settings, TrendingUp, Gift, LogOut, Save, ShieldCheck, Store, Megaphone, ShoppingBag } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CreateMenu } from '../components/CreateMenu';

export default function ProfilePage() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [balances, setBalances] = useState<BalanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '' });
  const [becoming, setBecoming] = useState(false);

  useEffect(() => {
    Promise.all([getProfile(), getStats(), getBalance().catch(() => null)]).then(([p, s, b]) => { setProfile(p); setStats(s); setBalances(b); setForm({ name: p.name || '', phone: p.phone || '' }); }).finally(() => setLoading(false));
  }, []);

  const handleSave = async () => { try { await updateProfile({ ...form, phone: unformatPhone(form.phone) }); const p = await getProfile(); setProfile(p); setEditing(false); toast.success('Профиль обновлён'); } catch { toast.error('Ошибка'); } };
  const handleLogout = () => { window.OneSignal?.logout()?.catch(() => {}); localStorage.clear(); navigate('/login'); };

  const handleBecomeSeller = async () => {
    if (becoming) return;
    setBecoming(true);
    try {
      const res = await becomeSeller();
      if (res?.accessToken) localStorage.setItem('accessToken', res.accessToken);
      setProfile((p: any) => ({ ...p, ...res?.user, role: res?.user?.role || 'SELLER' }));
      toast.success('Теперь ты можешь продавать');
    } catch {
      toast.error('Не удалось стать продавцом');
    } finally {
      setBecoming(false);
    }
  };

  const role: string = profile?.role || 'BUYER';
  const isSeller = role === 'SELLER' || role === 'ADMIN';

  const menuItems: { label: string; to: string; icon: React.ReactNode }[] = [
    { label: 'Мои заказы', to: '/orders', icon: <ShoppingBag size={16} /> },
    { label: 'Рефералы', to: '/referrals', icon: <Gift size={16} /> },
    { label: 'Вывод средств', to: '/withdrawals', icon: <TrendingUp size={16} /> },
    ...(isSeller ? [
      { label: 'Мои товары', to: '/my-products', icon: <Store size={16} /> },
      { label: 'Создать рекламу', to: '/posts/ad/new', icon: <Megaphone size={16} /> },
    ] : []),
    ...(role === 'BUYER' ? [
      { label: 'Стать продавцом', to: '#become-seller', icon: <Store size={16} /> },
    ] : []),
    ...(role === 'ADMIN' ? [
      { label: 'Админ-панель', to: '/admin', icon: <ShieldCheck size={16} /> },
    ] : []),
  ];

  if (loading) return (
    <div className="flex justify-center py-32">
      <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#22c55e] to-[#34d399] animate-pulse" />
    </div>
  );

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div className="fixed inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 60% 40% at 50% -5%, rgba(34,197,94,0.10) 0%, transparent 60%)'
      }} />

      <div className="relative max-w-2xl mx-auto px-4 sm:px-6 pt-10 pb-20">
        <h1 className="text-2xl font-bold text-[var(--color-text)] mb-1">Профиль</h1>
        <p className="text-[var(--color-muted)] text-sm mb-6">Данные аккаунта</p>

        <div className="rounded-[26px] bg-[var(--color-surface)] border border-[var(--color-border)] p-6 mb-6">
          <div className="flex items-center gap-5 mb-6">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#22c55e] to-[#34d399] text-[#0d1512] text-xl font-extrabold flex items-center justify-center shadow-[0_8px_32px_-8px_rgba(34,197,94,0.5)]">
              {(profile?.name?.[0] || '?').toUpperCase()}
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-[var(--color-text)]">{profile?.name || 'Пользователь'}</h2>
              <p className="text-[var(--color-muted)] text-sm">{formatPhone(profile?.phone)}</p>
              <span className="inline-block mt-1 px-2.5 py-0.5 rounded-full bg-[#22c55e]/10 text-[#22c55e] text-[11px] font-bold">
                {profile?.role === 'ADMIN' ? 'Админ' : profile?.role === 'SELLER' ? 'Продавец' : 'Покупатель'}
              </span>
            </div>
          </div>
          {editing ? (
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-[var(--color-muted)] mb-1">Имя</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full px-4 py-2.5 rounded-xl bg-[var(--bg-3)] border border-[var(--color-border)] text-[var(--color-text)] text-sm outline-none focus:border-[#22c55e]/50 transition-all" />
              </div>
              <div>
                <label className="block text-sm text-[var(--color-muted)] mb-1">Телефон</label>
                <IMaskInput mask="+7 (000) 000-00-00" value={form.phone} onAccept={(value: string) => setForm({ ...form, phone: value })} placeholder="+7 (999) 123-45-67" className="w-full px-4 py-2.5 rounded-xl bg-[var(--bg-3)] border border-[var(--color-border)] text-[var(--color-text)] text-sm outline-none focus:border-[#22c55e]/50 transition-all" />
              </div>
              <div className="flex gap-2">
                <button onClick={handleSave} className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#22c55e] text-[#0d1512] text-sm font-bold transition-colors hover:bg-[#16a34a]"><Save size={14} /> Сохранить</button>
                <button onClick={() => setEditing(false)} className="px-5 py-2.5 rounded-full bg-[var(--bg-3)] text-[var(--color-muted)] text-sm font-medium hover:text-[var(--color-text)] transition-all">Отмена</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setEditing(true)} className="flex items-center gap-2 px-4 min-h-[44px] rounded-full bg-[var(--bg-3)] text-[var(--color-muted)] text-sm font-medium hover:text-[var(--color-text)] transition-all"><Settings size={14} /> Редактировать</button>
          )}
        </div>

        {/* §4.6: раздельные балансы */}
        <div className="rounded-[26px] bg-[#0b0e0d] border border-[#22c55e]/30 p-6 mb-6">
          <p className="text-[11px] uppercase tracking-[0.25em] text-[var(--color-muted)] mb-1">Доступно к выводу</p>
          <p className="text-3xl font-extrabold text-[#22c55e] mb-4">
            {formatPrice(balances?.totalWithdrawable ?? 0)}
          </p>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Основной', value: balances?.availableBalance ?? 0, color: '#22c55e' },
              { label: 'Реферальные', value: balances?.bonusBalance ?? 0, color: '#34d399' },
              { label: 'В эскроу', value: balances?.pendingEscrow ?? 0, color: 'var(--color-muted)' },
            ].map((b, i) => (
              <div key={i} className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] p-3">
                <div className="text-sm font-extrabold" style={{ color: b.color }}>{formatPrice(b.value)}</div>
                <div className="text-[10px] text-[var(--color-muted)] mt-0.5">{b.label}</div>
              </div>
            ))}
          </div>
          {balances && balances.pendingEscrow > 0 && (
            <p className="mt-3 text-[11px] text-[var(--color-muted)]">
              Средства в эскроу заморожены до подтверждения получения покупателем.
            </p>
          )}
        </div>

        {stats && (
          <div className="grid grid-cols-2 gap-3 mb-6">
            {[
              { label: 'Покупок', value: stats.boughtCount, icon: <TrendingUp size={16} /> },
              { label: 'Продаж', value: stats.soldCount, icon: <Gift size={16} /> },
              { label: 'Заработано', value: formatPrice(stats.soldEarned || 0), icon: <TrendingUp size={16} />, color: '#22c55e' },
              { label: 'Рефералы', value: formatPrice(stats.referralEarned || 0), icon: <User size={16} /> },
              { label: 'Реф. бонусы', value: formatPrice(balances?.bonusBalance ?? stats.bonusBalance ?? 0), icon: <TrendingUp size={16} /> },
            ].map((s: any, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }} className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] p-4">
                <div className="w-9 h-9 mb-2 rounded-xl flex items-center justify-center" style={{ background: 'rgba(34,197,94,0.1)', color: s.color || '#22c55e' }}>{s.icon}</div>
                <div className="text-lg font-extrabold" style={{ color: s.color || 'var(--color-text)' }}>{s.value}</div>
                <div className="text-[11px] text-[var(--color-muted)]">{s.label}</div>
              </motion.div>
            ))}
          </div>
        )}

        {/* Создать — один блок с одним CTA */}
        <div className="rounded-2xl bg-[var(--color-surface)] border border-[#22c55e]/30 p-4 mb-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-bold text-[var(--color-text)]">Создать</div>
            <div className="text-[12px] text-[var(--color-muted)] mt-0.5">
              {isSeller ? 'Товар или пост в ленту' : 'Пост в ленту'}
            </div>
          </div>
          <CreateMenu variant="button" label="Товар или пост" className="shrink-0" />
        </div>

        {/* D8/R20: последний пункт не должен уходить под плавающее нижнее меню */}
        <div className="space-y-2 pb-nav-safe md:pb-0">
          {menuItems.map((item, i) => (
            <button
              key={i}
              disabled={becoming && item.to === '#become-seller'}
              onClick={() => item.to === '#become-seller' ? handleBecomeSeller() : navigate(item.to)}
              className="w-full rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] p-4 text-left transition-all flex items-center justify-between hover:border-[#22c55e]/40 disabled:opacity-60"
            >
              <span className="text-sm font-bold text-[var(--color-text)] flex items-center gap-2">{item.icon}{item.label}</span>
              <span className="text-[#22c55e]">→</span>
            </button>
          ))}
        </div>

        <div className="mt-6">
          <button onClick={handleLogout} className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-red-400/5 border border-red-400/20 text-red-400 font-bold text-sm hover:bg-red-400/10 transition-all"><LogOut size={16} /> Выйти</button>
        </div>
      </div>
    </div>
  );
}