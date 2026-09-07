import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { login } from '../api/auth';
import { maskPhoneInput, unformatPhone } from '../utils/phone';
import { KeyRound, Eye, EyeOff, ArrowLeft, ArrowRight } from 'lucide-react';

export default function LoginPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ phone: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [attempted, setAttempted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    if (!form.phone || !form.password) return;
    setLoading(true); setError('');
    try {
      const { accessToken, refreshToken } = await login(unformatPhone(form.phone), form.password);
      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('refreshToken', refreshToken);
      const payload = JSON.parse(atob(accessToken.split('.')[1]));
      localStorage.setItem('userId', payload.sub);
      navigate('/');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Ошибка входа');
    } finally { setLoading(false); }
  };

  const borderFor = (filled: boolean) =>
    attempted && !filled ? 'border-red-400/60' : 'border-[var(--color-border)]';

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 relative">
      <div className="absolute inset-0 -z-10 pointer-events-none overflow-hidden rounded-[34px]">
        <div className="absolute top-0 right-1/4 w-72 h-72 rounded-full blur-3xl opacity-30" style={{ background: 'radial-gradient(circle, #34d399, transparent 70%)' }} />
        <div className="absolute bottom-0 left-1/4 w-72 h-72 rounded-full blur-3xl opacity-30" style={{ background: 'radial-gradient(circle, #22c55e, transparent 70%)' }} />
      </div>

      <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
        <Link to="/" className="inline-flex items-center gap-2 text-[var(--color-muted)] hover:text-[var(--color-text)] mb-8 transition-colors text-sm"><ArrowLeft size={16} /> На главную</Link>

        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[28px] p-8">
          <div className="text-center mb-8">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-[#22c55e] to-[#14b8a6] flex items-center justify-center shadow-[0_12px_36px_-8px_rgba(34,197,94,0.6)]">
              <KeyRound size={28} className="text-[#0b0e0d]" />
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight text-[var(--color-text)] mb-1">С возвращением</h1>
            <p className="text-[var(--color-muted)] text-sm">Войди, чтобы продолжить</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--color-muted)] mb-1.5">Телефон</label>
              <input
                type="text"
                value={form.phone}
                onChange={e => setForm({ ...form, phone: maskPhoneInput(e.target.value) })}
                placeholder="+7 (999) 123-45-67"
                className={`w-full px-4 py-3 rounded-xl bg-[var(--bg-3)] border text-[var(--color-text)] text-sm placeholder:text-[var(--color-faint)] outline-none focus:border-[#22c55e]/50 transition-colors ${borderFor(!!form.phone)}`}
              />
              {attempted && !form.phone && <p className="text-xs text-red-400 mt-1">Введи телефон</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--color-muted)] mb-1.5">Пароль</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  placeholder="Ваш пароль"
                  className={`w-full px-4 py-3 pr-12 rounded-xl bg-[var(--bg-3)] border text-[var(--color-text)] text-sm placeholder:text-[var(--color-faint)] outline-none focus:border-[#22c55e]/50 transition-colors ${borderFor(!!form.password)}`}
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors">
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {attempted && !form.password && <p className="text-xs text-red-400 mt-1">Введи пароль</p>}
            </div>

            {error && <p className="text-sm font-medium text-red-400 bg-red-400/5 rounded-xl px-4 py-2.5">{error}</p>}

            <button type="submit" disabled={loading} className="mt-2 w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-[#22c55e] text-[#0b0e0d] font-extrabold text-base hover:bg-[#16a34a] transition-colors shadow-[0_12px_32px_-8px_rgba(34,197,94,0.5)] disabled:opacity-50">
              {loading ? 'Входим...' : <><span>Войти</span><ArrowRight size={18} /></>}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-[var(--color-border)] text-center">
            <p className="text-[var(--color-muted)] text-sm">Нет аккаунта? <Link to="/register" className="text-[#22c55e] hover:text-[#16a34a] font-semibold">Зарегистрироваться</Link></p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}