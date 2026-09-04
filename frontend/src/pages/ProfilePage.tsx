import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { getProfile, updateProfile, getStats } from '../api/users';
import { User, Settings, TrendingUp, Gift, LogOut, Save } from 'lucide-react';
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

  const handleSave = async () => { try { await updateProfile(form); const p = await getProfile(); setProfile(p); setEditing(false); toast.success('Профиль обновлён'); } catch { toast.error('Ошибка'); } };
  const handleLogout = () => { window.OneSignal?.logout()?.catch(() => {}); localStorage.clear(); navigate('/login'); };

  if (loading) return <div className="flex justify-center py-32"><div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 animate-pulse" /></div>;

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}><h1 className="text-2xl font-bold text-white mb-2">Профиль</h1><p className="text-white/60 text-sm mb-8">Управление аккаунтом</p></motion.div>

      <div className="bg-[#1a1a24] border border-white/[0.06] rounded-2xl p-6 mb-6">
        <div className="flex items-center gap-5 mb-6">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white text-xl font-bold flex items-center justify-center shadow-lg shadow-indigo-500/25">{(profile?.name?.[0] || '?').toUpperCase()}</div>
          <div>
            <h2 className="text-lg font-bold text-white">{profile?.name || 'Пользователь'}</h2>
            <p className="text-white/60 text-sm">{profile?.phone}</p>
            <span className="inline-block mt-1 px-2.5 py-0.5 rounded-full bg-indigo-400/10 text-indigo-400 text-[11px] font-semibold">{profile?.role === 'ADMIN' ? 'Админ' : profile?.role === 'SELLER' ? 'Продавец' : 'Покупатель'}</span>
          </div>
        </div>
        {editing ? (
          <div className="space-y-3">
            <div><label className="block text-sm text-white/60 mb-1">Имя</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white text-sm outline-none focus:border-indigo-500/50 transition-all" /></div>
            <div><label className="block text-sm text-white/60 mb-1">Телефон</label><input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white text-sm outline-none focus:border-indigo-500/50 transition-all" /></div>
            <div className="flex gap-2"><button onClick={handleSave} className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-500 text-white text-sm font-semibold hover:bg-indigo-400 transition-all shadow-lg"><Save size={14} /> Сохранить</button><button onClick={() => setEditing(false)} className="px-5 py-2.5 rounded-xl bg-white/[0.04] text-white/60 text-sm font-medium hover:bg-white/[0.08] transition-all">Отмена</button></div>
          </div>
        ) : (
          <button onClick={() => setEditing(true)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.04] text-white/60 text-sm font-medium hover:bg-white/[0.08] hover:text-white transition-all"><Settings size={14} /> Редактировать</button>
        )}
      </div>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[{ label: 'Покупок', value: stats.boughtCount, icon: <TrendingUp size={16} />, color: 'from-indigo-500 to-blue-600' }, { label: 'Продаж', value: stats.soldCount, icon: <Gift size={16} />, color: 'from-purple-500 to-pink-600' }, { label: 'Рефералы', value: `${stats.referralEarned || 0} ₽`, icon: <User size={16} />, color: 'from-amber-500 to-orange-600' }, { label: 'Баланс', value: `${stats.bonusBalance || 0} ₽`, icon: <TrendingUp size={16} />, color: 'from-emerald-500 to-teal-600' }].map((s, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }} className="bg-[#1a1a24] border border-white/[0.06] rounded-2xl p-4 text-center">
              <div className={`w-9 h-9 mx-auto mb-2 rounded-xl bg-gradient-to-br ${s.color} flex items-center justify-center text-white`}>{s.icon}</div>
              <div className="text-lg font-bold text-white">{s.value}</div>
              <div className="text-[11px] text-white/50">{s.label}</div>
            </motion.div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {[{ label: 'Мои заказы', to: '/orders' }, { label: 'Рефералы', to: '/referrals' }, { label: 'Вывод средств', to: '/withdrawals' }].map((item, i) => (
          <button key={i} onClick={() => navigate(item.to)} className="w-full bg-[#1a1a24] border border-white/[0.06] rounded-2xl p-4 text-left hover:border-white/[0.12] transition-all flex items-center justify-between"><span className="text-sm font-medium text-white">{item.label}</span><span className="text-white/35">→</span></button>
        ))}
      </div>

      <div className="mt-6"><button onClick={handleLogout} className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-red-400/5 border border-red-400/20 text-red-400 font-semibold text-sm hover:bg-red-400/10 transition-all"><LogOut size={16} /> Выйти</button></div>
    </div>
  );
}
