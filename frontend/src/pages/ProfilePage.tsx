import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { getProfile, updateProfile, getStats } from '../api/users';
import InputMask from 'react-input-mask';
import { formatPhone, unformatPhone } from '../utils/phone';
import { User, Settings, TrendingUp, Gift, LogOut, Save, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

export default function ProfilePage() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '' });

  useEffect(() => {
    Promise.all([getProfile(), getStats()]).then(([p, s]) => { setProfile(p); setStats(s); setForm({ name: p.name || '', phone: p.phone || '' }); }).finally(() => setLoading(false));
  }, []);

  const handleSave = async () => { try { await updateProfile({ ...form, phone: unformatPhone(form.phone) }); const p = await getProfile(); setProfile(p); setEditing(false); toast.success('Профиль обновлён'); } catch { toast.error('Ошибка'); } };
  const handleLogout = () => { window.OneSignal?.logout()?.catch(() => {}); localStorage.clear(); navigate('/login'); };

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
                <InputMask mask="+7 (999) 999-99-99" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+7 (999) 123-45-67" className="w-full px-4 py-2.5 rounded-xl bg-[var(--bg-3)] border border-[var(--color-border)] text-[var(--color-text)] text-sm outline-none focus:border-[#22c55e]/50 transition-all" />
              </div>
              <div className="flex gap-2">
                <button onClick={handleSave} className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#22c55e] text-[#0d1512] text-sm font-bold transition-colors hover:bg-[#16a34a]"><Save size={14} /> Сохранить</button>
                <button onClick={() => setEditing(false)} className="px-5 py-2.5 rounded-full bg-[var(--bg-3)] text-[var(--color-muted)] text-sm font-medium hover:text-[var(--color-text)] transition-all">Отмена</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setEditing(true)} className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-[var(--bg-3)] text-[var(--color-muted)] text-sm font-medium hover:text-[var(--color-text)] transition-all"><Settings size={14} /> Редактировать</button>
          )}
        </div>

        {stats && (
          <div className="grid grid-cols-2 gap-3 mb-6">
            {[
              { label: 'Покупок', value: stats.boughtCount, icon: <TrendingUp size={16} /> },
              { label: 'Продаж', value: stats.soldCount, icon: <Gift size={16} /> },
              { label: 'Рефералы', value: `${stats.referralEarned || 0} USDT`, icon: <User size={16} /> },
              { label: 'Баланс', value: `${stats.bonusBalance || 0} USDT`, icon: <TrendingUp size={16} /> },
            ].map((s, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }} className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] p-4">
                <div className="w-9 h-9 mb-2 rounded-xl flex items-center justify-center text-[#22c55e]" style={{ background: 'rgba(34,197,94,0.1)' }}>{s.icon}</div>
                <div className="text-lg font-extrabold text-[var(--color-text)]">{s.value}</div>
                <div className="text-[11px] text-[var(--color-muted)]">{s.label}</div>
              </motion.div>
            ))}
          </div>
        )}

        <div className="space-y-2">
          {[
            { label: 'Мои заказы', to: '/orders' },
            { label: 'Рефералы', to: '/referrals' },
            { label: 'Вывод средств', to: '/withdrawals' },
            ...(profile?.role === 'ADMIN' ? [{ label: 'Админ-панель', to: '/admin', icon: <ShieldCheck size={16} /> }] : []),
          ].map((item, i) => (
            <button key={i} onClick={() => navigate(item.to)} className="w-full rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] p-4 text-left transition-all flex items-center justify-between hover:border-[#22c55e]/40">
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