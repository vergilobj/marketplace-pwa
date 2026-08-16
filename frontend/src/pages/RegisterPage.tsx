import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { register } from '../api/auth';
import { UserPlus, ArrowLeft, Sparkles, Gift } from 'lucide-react';

export default function RegisterPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ phone: '', name: '', password: '', inviteCode: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setError('');
    try {
      const { accessToken, refreshToken } = await register(form.phone, form.name, form.password, form.inviteCode);
      localStorage.setItem('accessToken', accessToken); localStorage.setItem('refreshToken', refreshToken);
      const payload = JSON.parse(atob(accessToken.split('.')[1])); localStorage.setItem('userId', payload.sub);
      navigate('/');
    } catch (err: any) { setError(err.response?.data?.message || 'Ошибка регистрации'); } finally { setLoading(false); }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
        <Link to="/" className="inline-flex items-center gap-2 text-white/60 hover:text-white mb-8 transition-colors text-sm"><ArrowLeft size={16} /> На главную</Link>
        
        <div className="bg-[#1a1a24] border border-white/[0.06] rounded-3xl p-8 shadow-2xl shadow-black/50">
          <div className="text-center mb-8">
            <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center shadow-lg shadow-purple-500/25"><UserPlus size={24} className="text-white" /></div>
            <h1 className="text-2xl font-bold text-white mb-1">Создать аккаунт</h1>
            <p className="text-white/60 text-sm flex items-center justify-center gap-1.5"><Gift size={14} className="text-purple-400" /> Требуется код приглашения</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {[{ label: 'Телефон', val: 'phone', ph: '+7 (999) 123-45-67' }, { label: 'Имя', val: 'name', ph: 'Ваше имя' }, { label: 'Пароль', val: 'password', ph: 'Минимум 6 символов', type: 'password' }, { label: 'Код приглашения', val: 'inviteCode', ph: 'Введите инвайт-код' }].map(f => (
              <div key={f.val}><label className="block text-sm font-medium text-white/60 mb-1.5">{f.label}</label><input type={f.type || 'text'} value={(form as any)[f.val]} onChange={e => setForm({ ...form, [f.val]: e.target.value })} placeholder={f.ph} className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white text-sm placeholder:text-white/50 outline-none focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/10 transition-all" required /></div>
            ))}
            {error && <p className="text-sm font-medium text-red-400 bg-red-400/5 rounded-xl px-4 py-2.5">{error}</p>}
            <button type="submit" disabled={loading} className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-br from-purple-500 to-pink-600 text-white font-semibold text-sm hover:from-purple-400 transition-all shadow-lg shadow-purple-500/25 disabled:opacity-50">{loading ? '...' : <><Sparkles size={16} /> Зарегистрироваться</>}</button>
          </form>

          <div className="mt-6 pt-6 border-t border-white/[0.06] text-center">
            <p className="text-white/60 text-sm">Уже есть аккаунт? <Link to="/login" className="text-indigo-400 hover:text-indigo-300 font-semibold">Войти</Link></p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
