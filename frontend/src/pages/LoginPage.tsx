import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { login } from '../api/auth';
import { LogIn, ArrowLeft, Sparkles } from 'lucide-react';
import { CometChat } from '@cometchat/chat-sdk-javascript';
const COMETCHAT_AUTH_KEY = import.meta.env.VITE_COMETCHAT_AUTH_KEY || '';

export default function LoginPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ phone: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setError('');
    try {
      const { accessToken, refreshToken } = await login(form.phone, form.password);
      localStorage.setItem('accessToken', accessToken); localStorage.setItem('refreshToken', refreshToken);
      const payload = JSON.parse(atob(accessToken.split('.')[1])); localStorage.setItem('userId', payload.sub);
      try { await CometChat.login(payload.sub, COMETCHAT_AUTH_KEY); } catch { /* CometChat login failed, non-blocking */ }
      navigate('/');
    } catch (err: any) { setError(err.response?.data?.message || 'Ошибка входа'); } finally { setLoading(false); }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
        <Link to="/" className="inline-flex items-center gap-2 text-white/60 hover:text-white mb-8 transition-colors text-sm"><ArrowLeft size={16} /> На главную</Link>
        
        <div className="bg-[#1a1a24] border border-white/[0.06] rounded-3xl p-8 shadow-2xl shadow-black/50">
          <div className="text-center mb-8">
            <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/25"><LogIn size={24} className="text-white" /></div>
            <h1 className="text-2xl font-bold text-white mb-1">С возвращением</h1>
            <p className="text-white/60 text-sm">Войдите в свой аккаунт</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div><label className="block text-sm font-medium text-white/60 mb-1.5">Телефон</label><input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+7 (999) 123-45-67" className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white text-sm placeholder:text-white/35 outline-none focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/10 transition-all" required /></div>
            <div><label className="block text-sm font-medium text-white/60 mb-1.5">Пароль</label><input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="Ваш пароль" className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white text-sm placeholder:text-white/35 outline-none focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/10 transition-all" required /></div>
            {error && <p className="text-sm font-medium text-red-400 bg-red-400/5 rounded-xl px-4 py-2.5">{error}</p>}
            <button type="submit" disabled={loading} className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-semibold text-sm hover:from-indigo-400 transition-all shadow-lg shadow-indigo-500/25 disabled:opacity-50">{loading ? '...' : <><Sparkles size={16} /> Войти</>}</button>
          </form>

          <div className="mt-6 pt-6 border-t border-white/[0.06] text-center">
            <p className="text-white/60 text-sm">Нет аккаунта? <Link to="/register" className="text-indigo-400 hover:text-indigo-300 font-semibold">Зарегистрироваться</Link></p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
