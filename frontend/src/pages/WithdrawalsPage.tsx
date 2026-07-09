import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import api from '../api/axios';
import { Download, Clock, CheckCircle2, XCircle, Wallet } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import toast from 'react-hot-toast';

const sc: Record<string,{i:React.ReactNode;v:string;l:string}> = { pending:{i:<Clock size={13}/>,v:'warning',l:'На рассмотрении'}, approved:{i:<CheckCircle2 size={13}/>,v:'success',l:'Одобрена'}, rejected:{i:<XCircle size={13}/>,v:'danger',l:'Отклонена'} };

export default function WithdrawalsPage() {
  const [list, setList] = useState<any[]>([]);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState('');
  const [req, setReq] = useState(false);

  const fetch = async () => { try { const [w,b] = await Promise.all([api.get('/users/me/withdrawals'),api.get('/users/me/balance')]); setList(w.data||[]); setBalance(b.data.balance||0); } finally { setLoading(false); } };
  useEffect(()=>{fetch();},[]);

  const handleReq = async () => {
    const a = parseFloat(amount); if(!a||a<=0){toast.error('Введите сумму');return;} if(a>balance){toast.error('Недостаточно средств');return;}
    setReq(true); try { await api.post('/users/me/withdrawal',{amount:a}); toast.success('Заявка создана'); setAmount(''); fetch(); } catch(e:any){ toast.error(e.response?.data?.message||'Ошибка'); } finally { setReq(false); }
  };

  if (loading) return <div className="flex justify-center py-32"><div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 animate-pulse" /></div>;

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <motion.div initial={{opacity:0,y:-10}} animate={{opacity:1,y:0}}><h1 className="text-2xl font-bold text-white mb-2">Вывод средств</h1><p className="text-white/60 text-sm mb-8">Заявки на вывод бонусного баланса</p></motion.div>

      <motion.div initial={{opacity:0,scale:.97}} animate={{opacity:1,scale:1}} className="bg-[#1a1a24] border border-white/[0.06] rounded-2xl p-6 mb-6 bg-gradient-to-br from-emerald-500/5 to-teal-500/5">
        <div className="flex items-center gap-4 mb-4"><div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg"><Wallet size={20} className="text-white"/></div><div><p className="text-white/60 text-xs">Доступный баланс</p><p className="text-2xl font-bold text-emerald-400">{balance.toLocaleString('ru-RU')} ₽</p></div></div>
        <div className="flex gap-2"><input type="number" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="Сумма" className="flex-1 px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white text-sm placeholder:text-white/35 outline-none focus:border-emerald-500/50 transition-all"/><button onClick={handleReq} disabled={req} className="px-5 py-2.5 rounded-xl bg-emerald-500 text-white font-semibold text-sm hover:bg-emerald-400 transition-all shadow-lg disabled:opacity-50">{req?'...':'Вывести'}</button></div>
      </motion.div>

      <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2"><Download size={16}/> История</h3>
      {list.length===0 ? <div className="text-center py-16"><Download size={40} className="mx-auto text-white/10 mb-4"/><p className="text-white/60">Нет заявок</p></div> :
        <div className="space-y-2">{list.map((w,i)=>{ const c = sc[w.status]||sc.pending;
          return <motion.div key={w.id} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{delay:i*.03}} className="bg-[#1a1a24] border border-white/[0.06] rounded-2xl p-4 flex items-center justify-between"><div className="flex items-center gap-3"><div className="w-9 h-9 rounded-xl bg-white/[0.03] flex items-center justify-center">{c.i}</div><div><p className="text-sm font-semibold text-white">{w.amount.toLocaleString('ru-RU')} ₽</p><p className="text-[11px] text-white/35">{w.createdAt?format(new Date(w.createdAt),'d MMM, HH:mm',{locale:ru}):''}</p></div></div><span className={`px-2.5 py-1 rounded-full text-[10px] font-semibold ${c.v==='success'?'bg-emerald-400/10 text-emerald-400':c.v==='danger'?'bg-red-400/10 text-red-400':'bg-amber-400/10 text-amber-400'}`}>{c.l}</span></motion.div>;
        })}</div>}
    </div>
  );
}
