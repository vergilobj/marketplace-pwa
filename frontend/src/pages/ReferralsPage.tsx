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

  if (loading) return <div className="flex justify-center py-32"><div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 animate-pulse" /></div>;

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <motion.div initial={{opacity:0,y:-10}} animate={{opacity:1,y:0}}><h1 className="text-2xl font-bold text-white mb-2">Рефералы</h1><p className="text-white/60 text-sm mb-8">Приглашайте друзей и получайте бонусы</p></motion.div>

      <motion.div initial={{opacity:0,scale:.97}} animate={{opacity:1,scale:1}} className="bg-[#1a1a24] border border-white/[0.06] rounded-2xl p-6 mb-6 bg-gradient-to-br from-indigo-500/5 to-purple-500/5">
        <div className="text-center mb-4"><div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg"><Gift size={24} className="text-white"/></div><h2 className="text-lg font-bold text-white">Ваш реферальный код</h2><p className="text-white/60 text-sm mt-1">5% с заказов приглашённых</p></div>
        <div className="flex items-center gap-2 max-w-xs mx-auto"><div className="flex-1 bg-[#111115] rounded-xl px-4 py-3 text-center font-mono text-lg font-bold text-indigo-400 border border-white/[0.06]">{profile?.referralCode||'—'}</div><button onClick={copyCode} className={`p-3 rounded-xl transition-all ${copied?'bg-emerald-500 text-white':'bg-indigo-500 text-white hover:bg-indigo-400'} shadow-lg`}>{copied?<Check size={16}/>:<Copy size={16}/>}</button></div>
      </motion.div>

      <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2"><Users size={16}/> Приглашённые</h3>
      {refs.length===0 ? <div className="text-center py-16"><Users size={40} className="mx-auto text-white/10 mb-4"/><p className="text-white/60">Пока нет рефералов</p></div> :
        <div className="space-y-2">{refs.map((r,i)=><motion.div key={r.id} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{delay:i*.03}} className="bg-[#1a1a24] border border-white/[0.06] rounded-2xl p-4 flex items-center justify-between"><div><p className="text-sm font-semibold text-white">{r.buyer?.name||'Пользователь'}</p><p className="text-xs text-white/50">{r.product?.title||'Заказ'} • {r.createdAt?format(new Date(r.createdAt),'d MMM',{locale:ru}):''}</p></div><div className="text-right"><p className="font-bold text-emerald-400 text-sm">+{r.referralBonus||0} ₽</p></div></motion.div>)}</div>}
    </div>
  );
}
