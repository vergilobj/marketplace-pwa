import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { getProfile, updateProfile, getStats } from '../api/users';
import { formatPhone, maskPhoneInput, unformatPhone } from '../utils/phone';
import { User, Settings, TrendingUp, Gift, LogOut, Save } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

const GS = { background: 'linear-gradient(135deg, #6366f1 0%, #38bdf8 50%, #38bdf8 100%)' } as const;

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

  if (loading) return <div className="flex justify-center py-32"><div style={GS} className="w-10 h-10 rounded-2xl animate-pulse" /></div>;

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}><h1 className="text-2xl font-bold text-[var(--color-text)] mb-2">Профиль</h1><p className="text-[var(--color-muted)] text-sm mb-8">Управление аккаунтом</p></motion.div>

      <div className="glass-card rounded-[26px] p-6 mb-6">
        <div className="flex items-center gap-5 mb-6">
          <div style={GS} className="w-16 h-16 rounded-2xl text-[var(--color-text)] text-xl font-bold flex items-center justify-center shadow-[0_16px_40px_rgba(201,242,103,0.3)]">{(profile?.name?.[0] || '?').toUpperCase()}</div>
          <div>
            <h2 className="text-lg font-bold text-[var(--color-text)]">{profile?.name || 'Пользователь'}</h2>
            <p className="text-[var(--color-muted)] text-sm">{formatPhone(profile?.phone)}</p>
            <span className="inline-block mt-1 px-2.5 py-0.5 rounded-full bg-[rgba(201,242,103,0.1)] text-[#6366f1] text-[11px] font-semibold">{profile?.role === 'ADMIN' ? 'Админ' : profile?.role === 'SELLER' ? 'Продавец' : 'Покупатель'}</span>
          </div>
        </div>
        {editing ? (
          <div className="space-y-3">
            <div><label className="block text-sm text-[var(--color-muted)] mb-1">Имя</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full px-4 py-2.5 rounded-xl bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] text-[var(--color-text)] text-sm outline-none focus:border-[rgba(201,242,103,0.5)] focus:ring-4 focus:ring-[rgba(201,242,103,0.1)] transition-all" /></div>
            <div><label className="block text-sm text-[var(--color-muted)] mb-1">Телефон</label><input value={formatPhone(form.phone)} onChange={e => setForm({ ...form, phone: maskPhoneInput(e.target.value) })} placeholder="+7 (999) 123-45-67" className="w-full px-4 py-2.5 rounded-xl bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] text-[var(--color-text)] text-sm outline-none focus:border-[rgba(201,242,103,0.5)] focus:ring-4 focus:ring-[rgba(201,242,103,0.1)] transition-all" /></div>
            <div className="flex gap-2"><button onClick={handleSave} style={GS} className="flex items-center gap-2 px-5 py-2.5 rounded-full text-[var(--color-text)] text-sm font-semibold transition-all shadow-[0_8px_24px_rgba(201,242,103,0.3)] hover:scale-[1.02]"><Save size={14} /> Сохранить</button><button onClick={() => setEditing(false)} className="px-5 py-2.5 rounded-full bg-[rgba(255,255,255,0.04)] text-[var(--color-muted)] text-sm font-medium hover:bg-[rgba(255,255,255,0.08)] transition-all">Отмена</button></div>
          </div>
        ) : (
          <button onClick={() => setEditing(true)} className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-[rgba(255,255,255,0.04)] text-[var(--color-muted)] text-sm font-medium hover:bg-[rgba(255,255,255,0.08)] hover:text-[var(--color-text)] transition-all"><Settings size={14} /> Редактировать</button>
        )}
      </div>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[{ label: 'Покупок', value: stats.boughtCount, icon: <TrendingUp size={16} />, color: 'linear-gradient(135deg, #6366f1, #38bdf8)' }, { label: 'Продаж', value: stats.soldCount, icon: <Gift size={16} />, color: 'linear-gradient(135deg, #38bdf8, #38bdf8)' }, { label: 'Рефералы', value: `${stats.referralEarned || 0} USDT`, icon: <User size={16} />, color: 'linear-gradient(135deg, #6366f1, #38bdf8)' }, { label: 'Баланс', value: `${stats.bonusBalance || 0} USDT`, icon: <TrendingUp size={16} />, color: 'linear-gradient(135deg, #38bdf8, #38bdf8)' }].map((s, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }} className="glass-card rounded-2xl p-4 text-center">
              <div className="w-9 h-9 mx-auto mb-2 rounded-xl flex items-center justify-center text-[var(--color-text)] shadow-lg" style={{ background: s.color }}>{s.icon}</div>
              <div className="text-lg font-bold text-[var(--color-text)]">{s.value}</div>
              <div className="text-[11px] text-[var(--color-muted)]">{s.label}</div>
            </motion.div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {[{ label: 'Мои заказы', to: '/orders' }, { label: 'Рефералы', to: '/referrals' }, { label: 'Вывод средств', to: '/withdrawals' }].map((item, i) => (
          <button key={i} onClick={() => navigate(item.to)} className="w-full glass-card rounded-2xl p-4 text-left transition-all flex items-center justify-between hover:border-[rgba(201,242,103,0.4)]"><span className="text-sm font-medium text-[var(--color-text)]">{item.label}</span><span className="text-[var(--color-muted)]">→</span></button>
        ))}
      </div>

      <div className="mt-6"><button onClick={handleLogout} className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-red-400/5 border border-red-400/20 text-red-400 font-semibold text-sm hover:bg-red-400/10 transition-all"><LogOut size={16} /> Выйти</button></div>
    </div>
  );
}