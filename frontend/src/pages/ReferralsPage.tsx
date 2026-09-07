import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import api from '../api/axios';
import { Gift, Users, Copy, Check } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import toast from 'react-hot-toast';

export default function ReferralsPage() {
  const [refs, setRefs] = useState<any[]>([]);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    Promise.all([api.get('/users/me/referrals').then(r=>r.data), api.get('/users/me').then(r=>r.data)])
      .then(([r,p]) => { setRefs(Array.isArray(r)?r:[]); setProfile(p); }).finally(()=>setLoading(false));
  }, []);

  const copyCode = () => {
    if (profile?.referralCode) { navigator.clipboard.writeText(profile.referralCode); setCopied(true); toast.success('Скопировано!'); setTimeout(()=>setCopied(false),2000); }
  };

  if (loading) return <div className="flex justify-center py-32"><div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#22c55e] to-[#34d399] animate-pulse" /></div>;

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div className="fixed inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 60% 40% at 50% -5%, rgba(34,197,94,0.10) 0%, transparent 60%)'
      }} />

      <div className="relative max-w-2xl mx-auto px-4 sm:px-6 pt-10 pb-20">
        <h1 className="text-2xl font-bold text-[var(--color-text)] mb-1">Рефералы</h1>
        <p className="text-[var(--color-muted)] text-sm mb-6">Приглашайте своих</p>

        <motion.div initial={{opacity:0,scale:.97}} animate={{opacity:1,scale:1}} className="rounded-[26px] bg-[var(--color-surface)] border border-[var(--color-border)] p-6 mb-8">
          <div className="text-center mb-4">
            <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-gradient-to-br from-[#22c55e] to-[#34d399] flex items-center justify-center shadow-[0_8px_32px_-8px_rgba(34,197,94,0.5)]">
              <Gift size={24} className="text-[#0d1512]" />
            </div>
            <h2 className="text-lg font-extrabold text-[var(--color-text)]">Твой реферальный код</h2>
            <p className="text-[var(--color-muted)] text-sm mt-1">5% с заказов приглашённых</p>
          </div>
          <div className="flex items-center gap-2 max-w-xs mx-auto">
            <div className="flex-1 rounded-xl px-4 py-3 text-center font-mono text-lg font-bold text-[#22c55e] bg-[var(--bg-3)] border border-[var(--color-border)]">{profile?.referralCode||'—'}</div>
            <button onClick={copyCode} className={`p-3 rounded-full transition-all ${copied ? 'bg-[#22c55e] text-[#0d1512]' : 'bg-[#22c55e] text-[#0d1512] hover:bg-[#16a34a]'} shadow-[0_8px_24px_rgba(34,197,94,0.4)]`}>
              {copied ? <Check size={16}/> : <Copy size={16}/>}
            </button>
          </div>
        </motion.div>

        <h3 className="text-base font-extrabold text-[var(--color-text)] mb-4 flex items-center gap-2"><Users size={16}/> Приглашённые</h3>
        {refs.length===0 ? (
          <div className="text-center py-16">
            <Users size={40} className="mx-auto text-[var(--color-faint)] mb-4"/>
            <p className="text-[var(--color-muted)]">Пока никого — зазывай своих</p>
          </div>
        ) : (
          <div className="space-y-2">
            {refs.map((r,i) => (
              <motion.div key={r.id} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{delay:i*.03}} className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-[var(--color-text)]">{r.buyer?.name||'Пользователь'}</p>
                  <p className="text-xs text-[var(--color-muted)]">{r.product?.title||'Заказ'} • {r.createdAt?format(new Date(r.createdAt),'d MMM',{locale:ru}):''}</p>
                </div>
                <div className="text-right">
                  <p className="font-extrabold text-[#22c55e] text-sm">+{r.referralBonus||0} USDT</p>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}