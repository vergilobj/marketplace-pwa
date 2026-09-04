import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { register } from '../api/auth';
import { formatPhone, maskPhoneInput, unformatPhone } from '../utils/phone';
import { UserPlus, ArrowLeft, Sparkles, Gift } from 'lucide-react';

export default function RegisterPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const inviteFromUrl = searchParams.get('code') || '';
  const [form, setForm] = useState({ phone: '', name: '', password: '', inviteCode: inviteFromUrl });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setError('');
    try {
      const { accessToken, refreshToken } = await register(unformatPhone(form.phone), form.name, form.password, form.inviteCode);
      localStorage.setItem('accessToken', accessToken); localStorage.setItem('refreshToken', refreshToken);
      const payload = JSON.parse(atob(accessToken.split('.')[1])); localStorage.setItem('userId', payload.sub);
      navigate('/');
    } catch (err: any) { setError(err.response?.data?.message || 'Ошибка регистрации'); } finally { setLoading(false); }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 relative">
      <div className="absolute inset-0 -z-10 pointer-events-none overflow-hidden rounded-[34px]">
        <div className="absolute top-0 right-1/4 w-72 h-72 rounded-full blur-3xl opacity-30" style={{ background: 'radial-gradient(circle, #38bdf8, transparent 70%)' }} />
        <div className="absolute bottom-0 left-1/4 w-72 h-72 rounded-full blur-3xl opacity-30" style={{ background: 'radial-gradient(circle, #6366f1, transparent 70%)' }} />
      </div>

      <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
        <Link to="/" className="inline-flex items-center gap-2 text-[var(--color-muted)] hover:text-[var(--color-text)] mb-8 transition-colors text-sm"><ArrowLeft size={16} /> На главную</Link>

        <div className="glass-card rounded-[34px] p-8 shadow-[0_30px_80px_rgba(0,0,0,0.55)]">
          <div className="text-center mb-8">
            <div style={{ background: 'linear-gradient(135deg, #38bdf8 0%, #6366f1 100%)' }} className="w-14 h-14 mx-auto mb-4 rounded-2xl flex items-center justify-center shadow-[0_16px_40px_rgba(142,232,255,0.35)]"><UserPlus size={24} className="text-[#0b0e0d]" /></div>
            <h1 className="text-2xl font-bold text-[var(--color-text)] mb-1">Создать аккаунт</h1>
            <p className="text-[var(--color-muted)] text-sm flex items-center justify-center gap-1.5"><Gift size={14} className="text-[#38bdf8]" /> Требуется код приглашения</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {[{ label: 'Телефон', val: 'phone', ph: '+7 (999) 123-45-67' }, { label: 'Имя', val: 'name', ph: 'Ваше имя' }, { label: 'Пароль', val: 'password', ph: 'Минимум 6 символов', type: 'password' }, { label: 'Код приглашения', val: 'inviteCode', ph: 'Введите инвайт-код' }].map(f => (
              <div key={f.val}><label className="block text-sm font-medium text-[var(--color-muted)] mb-1.5">{f.label}</label><input type={f.type || 'text'} value={f.val === 'phone' ? formatPhone((form as any)[f.val]) : (form as any)[f.val]} onChange={e => setForm({ ...form, [f.val]: f.val === 'phone' ? maskPhoneInput(e.target.value) : e.target.value })} placeholder={f.ph} className="w-full px-4 py-3 rounded-xl bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] text-[var(--color-text)] text-sm placeholder:text-[var(--color-faint)] outline-none focus:border-[rgba(201,242,103,0.5)] focus:ring-4 focus:ring-[rgba(201,242,103,0.1)] transition-all" required /></div>
            ))}
            {error && <p className="text-sm font-medium text-red-400 bg-red-400/5 rounded-xl px-4 py-2.5">{error}</p>}
            <button type="submit" disabled={loading} style={{ background: 'linear-gradient(135deg, #38bdf8 0%, #6366f1 100%)' }} className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-full text-[#0b0e0d] font-semibold text-sm transition-all shadow-[0_16px_40px_rgba(142,232,255,0.3)] disabled:opacity-50 hover:scale-[1.02] active:scale-[0.98]">{loading ? '...' : <><Sparkles size={16} /> Зарегистрироваться</>}</button>
          </form>

          <div className="mt-6 pt-6 border-t border-[rgba(255,255,255,0.06)] text-center">
            <p className="text-[var(--color-muted)] text-sm">Уже есть аккаунт? <Link to="/login" className="text-[#6366f1] hover:text-[#4f46e5] font-semibold">Войти</Link></p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}