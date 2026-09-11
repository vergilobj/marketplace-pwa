import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import api from '../api/axios';
import { getBalance, getLedger, type BalanceResponse, type LedgerEntryItem } from '../api/users';
import { Download, Clock, CheckCircle2, XCircle, Wallet, History } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { formatPrice } from '../utils/format';
import toast from 'react-hot-toast';
import { errorMessage } from '../utils/error';
import type { ApiWithdrawal } from '../api/types';

const sc: Record<string, { i: React.ReactNode; v: string; l: string }> = {
  pending: { i: <Clock size={13} />, v: 'pending', l: 'На рассмотрении' },
  approved: { i: <CheckCircle2 size={13} />, v: 'approved', l: 'Одобрена' },
  rejected: { i: <XCircle size={13} />, v: 'rejected', l: 'Отклонена' },
};

const accountLabel: Record<string, string> = {
  AVAILABLE: 'Основной',
  REFERRAL: 'Реферальные',
  ESCROW: 'Эскроу',
  PLATFORM: 'Платформа',
};

export default function WithdrawalsPage() {
  const [list, setList] = useState<ApiWithdrawal[]>([]);
  const [balances, setBalances] = useState<BalanceResponse | null>(null);
  const [ledger, setLedger] = useState<LedgerEntryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState('');
  const [wallet, setWallet] = useState('');
  const [req, setReq] = useState(false);

  const fetch = async () => {
    try {
      const [w, b, l] = await Promise.all([
        api.get<ApiWithdrawal[]>('/users/me/withdrawals'),
        getBalance(),
        getLedger({ limit: 20 }).catch(() => ({ items: [], nextCursor: null })),
      ]);
      setList(w.data || []);
      setBalances(b);
      setLedger(l.items || []);
    } finally { setLoading(false); }
  };
  useEffect(() => { fetch(); }, []);

  // §5.2: вывод ограничен totalWithdrawable за вычетом уже поданных заявок.
  const pendingSum = list
    .filter((w) => w.status === 'pending')
    .reduce((s, w) => s + (w.amount || 0), 0);
  const withdrawable = Math.max((balances?.totalWithdrawable ?? 0) - pendingSum, 0);

  const handleReq = async () => {
    const a = parseFloat(amount);
    if (!a || a <= 0) { toast.error('Введите сумму'); return; }
    if (a > withdrawable) { toast.error('Недостаточно средств'); return; }
    const trimmed = wallet.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) { toast.error('Введите корректный BSC-адрес кошелька (0x + 40 hex)'); return; }
    setReq(true);
    try {
      await api.post('/users/me/withdrawal', { amount: a, toAddress: trimmed });
      toast.success('Заявка создана');
      setAmount(''); setWallet(''); fetch();
    } catch (e: unknown) { toast.error(errorMessage(e)); }
    finally { setReq(false); }
  };

  if (loading) return <div className="flex justify-center py-32"><div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#22c55e] to-[#34d399] animate-pulse" /></div>;

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div className="fixed inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse 60% 40% at 50% -5%, rgba(34,197,94,0.10) 0%, transparent 60%)' }} />
      <div className="relative max-w-2xl mx-auto px-4 sm:px-6 pt-10 pb-20">
        <h1 className="text-2xl font-bold text-[var(--color-text)] mb-1">Вывод средств</h1>
        <div className="mb-6" />

        <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="rounded-[26px] bg-[#0b0e0d] border border-[#22c55e]/30 p-6 mb-6">
          <div className="flex items-center gap-4 mb-5">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-gradient-to-br from-[#22c55e] to-[#34d399] shadow-[0_8px_32px_-8px_rgba(34,197,94,0.5)]"><Wallet size={20} className="text-[#0d1512]" /></div>
            <div>
              <p className="text-[var(--color-muted)] text-xs">Доступно к выводу</p>
              <p className="text-2xl font-extrabold text-[#22c55e]">{formatPrice(withdrawable)}</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-5">
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

          {pendingSum > 0 && (
            <p className="mb-4 text-[11px] text-amber-400/90">
              В заявках на вывод: {formatPrice(pendingSum)} — учтено в ограничении суммы.
            </p>
          )}

          <div className="space-y-2">
            <div className="flex gap-2">
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Сумма" className="flex-1 px-4 min-h-[44px] rounded-full bg-[var(--bg-3)] border border-[var(--color-border)] text-[var(--color-text)] text-sm placeholder:text-[var(--color-faint)] outline-none focus:border-[#22c55e]/50 transition-all" />
              <button onClick={handleReq} disabled={req} className="px-5 min-h-[44px] rounded-full bg-[#22c55e] text-[#0d1512] font-bold text-sm transition-colors hover:bg-[#16a34a] disabled:opacity-50">{req ? '...' : 'Вывести'}</button>
            </div>
            <input type="text" value={wallet} onChange={(e) => setWallet(e.target.value)} placeholder="BSC-адрес кошелька (0x...)" className="w-full px-4 min-h-[44px] rounded-full bg-[var(--bg-3)] border border-[var(--color-border)] text-[var(--color-text)] text-sm placeholder:text-[var(--color-faint)] outline-none focus:border-[#22c55e]/50 transition-all font-mono" />
          </div>
        </motion.div>

        <h3 className="text-base font-extrabold text-[var(--color-text)] mb-4 flex items-center gap-2"><Download size={16} /> История заявок</h3>
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
                      <p className="text-sm font-bold text-[var(--color-text)]">{formatPrice(w.amount)}</p>
                      <p className="text-[11px] text-[var(--color-muted)]">{w.createdAt ? format(new Date(w.createdAt), 'd MMM, HH:mm', { locale: ru }) : ''}</p>
                    </div>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${c.v === 'approved' ? 'bg-[#22c55e]/10 text-[#22c55e]' : c.v === 'rejected' ? 'bg-red-400/10 text-red-400' : 'bg-amber-400/10 text-amber-400'}`}>{c.l}</span>
                </motion.div>
              );
            })}
          </div>
        )}

        {ledger.length > 0 && (
          <>
            <h3 className="text-base font-extrabold text-[var(--color-text)] mt-8 mb-4 flex items-center gap-2"><History size={16} /> Операции</h3>
            <div className="space-y-2">
              {ledger.map((e, i) => (
                <motion.div key={e.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }} className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[12px] font-bold text-[var(--color-text)] truncate">{accountLabel[e.account] || e.account}</p>
                    <p className="text-[10px] text-[var(--color-muted)] truncate">{e.type}{e.createdAt ? ` · ${format(new Date(e.createdAt), 'd MMM, HH:mm', { locale: ru })}` : ''}</p>
                  </div>
                  <span className={`text-sm font-extrabold shrink-0 ${e.amount >= 0 ? 'text-[#22c55e]' : 'text-red-400'}`}>
                    {e.amount >= 0 ? '+' : '−'}{formatPrice(Math.abs(e.amount))}
                  </span>
                </motion.div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}