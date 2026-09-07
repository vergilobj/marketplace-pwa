import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import api from '../api/axios';
import { Download, Clock, CheckCircle2, XCircle, Wallet } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import toast from 'react-hot-toast';

const sc: Record<string, { i: React.ReactNode; v: string; l: string }> = {
  pending: { i: <Clock size={13} />, v: 'pending', l: 'На рассмотрении' },
  approved: { i: <CheckCircle2 size={13} />, v: 'approved', l: 'Одобрена' },
  rejected: { i: <XCircle size={13} />, v: 'rejected', l: 'Отклонена' },
};

export default function WithdrawalsPage() {
  const [list, setList] = useState<any[]>([]);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState('');
  const [wallet, setWallet] = useState('');
  const [req, setReq] = useState(false);

  const fetch = async () => {
    try {
      const [w, b] = await Promise.all([
        api.get('/users/me/withdrawals'),
        api.get('/users/me/balance'),
      ]);
      setList(w.data || []);
      setBalance(b.data.balance || 0);
    } finally { setLoading(false); }
  };
  useEffect(() => { fetch(); }, []);

  const handleReq = async () => {
    const a = parseFloat(amount);
    if (!a || a <= 0) { toast.error('Введите сумму'); return; }
    if (a > balance) { toast.error('Недостаточно средств'); return; }
    const trimmed = wallet.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) { toast.error('Введите корректный BSC-адрес кошелька (0x + 40 hex)'); return; }
    setReq(true);
    try {
      await api.post('/users/me/withdrawal', { amount: a, toAddress: trimmed });
      toast.success('Заявка создана');
      setAmount(''); setWallet(''); fetch();
    } catch (e: any) { toast.error(e.response?.data?.message || 'Ошибка'); }
    finally { setReq(false); }
  };

  if (loading) return <div className="flex justify-center py-32"><div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#22c55e] to-[#34d399] animate-pulse" /></div>;

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div className="fixed inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse 60% 40% at 50% -5%, rgba(34,197,94,0.10) 0%, transparent 60%)' }} />
      <div className="relative max-w-2xl mx-auto px-4 sm:px-6 pt-10 pb-20">
        <h1 className="text-2xl font-bold text-[var(--color-text)] mb-1">Вывод средств</h1>
        <div className="mb-6" />

        <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="rounded-[26px] bg-[var(--color-surface)] border border-[var(--color-border)] p-6 mb-6">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-gradient-to-br from-[#22c55e] to-[#34d399] shadow-[0_8px_32px_-8px_rgba(34,197,94,0.5)]"><Wallet size={20} className="text-[#0d1512]" /></div>
            <div>
              <p className="text-[var(--color-muted)] text-xs">Доступный баланс</p>
              <p className="text-2xl font-extrabold text-[#22c55e]">{balance.toLocaleString('ru-RU')} USDT</p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex gap-2">
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Сумма" className="flex-1 px-4 py-2.5 rounded-full bg-[var(--bg-3)] border border-[var(--color-border)] text-[var(--color-text)] text-sm placeholder:text-[var(--color-faint)] outline-none focus:border-[#22c55e]/50 transition-all" />
              <button onClick={handleReq} disabled={req} className="px-5 py-2.5 rounded-full bg-[#22c55e] text-[#0d1512] font-bold text-sm transition-colors hover:bg-[#16a34a] disabled:opacity-50">{req ? '...' : 'Вывести'}</button>
            </div>
            <input type="text" value={wallet} onChange={(e) => setWallet(e.target.value)} placeholder="BSC-адрес кошелька (0x...)" className="w-full px-4 py-2.5 rounded-full bg-[var(--bg-3)] border border-[var(--color-border)] text-[var(--color-text)] text-sm placeholder:text-[var(--color-faint)] outline-none focus:border-[#22c55e]/50 transition-all font-mono" />
          </div>
        </motion.div>

        <h3 className="text-base font-extrabold text-[var(--color-text)] mb-4 flex items-center gap-2"><Download size={16} /> История</h3>
        {list.length === 0 ? (
          <div className="text-center py-16"><Download size={40} className="mx-auto text-[var(--color-faint)] mb-4" /><p className="text-[var(--color-muted)]">Нет заявок</p></div>
        ) : (
          <div className="space-y-2">
            {list.map((w, i) => {
              const c = sc[w.status] || sc.pending;
              return (
                <motion.div key={w.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-[var(--bg-3)] flex items-center justify-center text-[#22c55e]">{c.i}</div>
                    <div>
                      <p className="text-sm font-bold text-[var(--color-text)]">{w.amount.toLocaleString('ru-RU')} USDT</p>
                      <p className="text-[11px] text-[var(--color-muted)]">{w.createdAt ? format(new Date(w.createdAt), 'd MMM, HH:mm', { locale: ru }) : ''}</p>
                    </div>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${c.v === 'approved' ? 'bg-[#22c55e]/10 text-[#22c55e]' : c.v === 'rejected' ? 'bg-red-400/10 text-red-400' : 'bg-amber-400/10 text-amber-400'}`}>{c.l}</span>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}