import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import api from '../api/axios';
import { Bell, Heart, MessageCircle, ShoppingBag, Gift, CheckCheck } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import toast from 'react-hot-toast';

const icons: Record<string, React.ReactNode> = { like: <Heart size={13} className="text-rose-400" />, comment: <MessageCircle size={13} className="text-blue-400" />, order: <ShoppingBag size={13} className="text-emerald-400" />, referral: <Gift size={13} className="text-amber-400" />, broadcast: <Bell size={13} className="text-purple-400" /> };

export default function NotificationsPage() {
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { api.get('/notifications').then(r => setList(r.data||[])).finally(() => setLoading(false)); }, []);

  const readAll = async () => { try { await api.patch('/notifications/read-all'); setList(p => p.map(n=>({...n,isRead:true}))); toast.success('Всё прочитано'); } catch { toast.error('Ошибка'); } };
  const markRead = async (id:string) => { try { await api.patch(`/notifications/${id}/read`); setList(p => p.map(n=>n.id===id?{...n,isRead:true}:n)); } catch { /* ignore */ } };

  if (loading) return <div className="flex justify-center py-32"><div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 animate-pulse" /></div>;

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between mb-6">
        <div><h1 className="text-2xl font-bold text-white mb-1">Уведомления</h1><p className="text-white/60 text-sm">{list.filter(n=>!n.isRead).length} непрочитанных</p></div>
        {list.some(n=>!n.isRead) && <button onClick={readAll} className="text-sm text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1"><CheckCheck size={14} /> Прочитать все</button>}
      </motion.div>
      {list.length === 0 ? <div className="text-center py-16"><Bell size={40} className="mx-auto text-white/10 mb-4" /><p className="text-white/60">Уведомлений нет</p></div> : (
        <div className="space-y-2">{list.map((n,i)=><motion.div key={n.id} initial={{opacity:0,x:-8}} animate={{opacity:1,x:0}} transition={{delay:i*0.02}} onClick={()=>!n.isRead&&markRead(n.id)} className={`bg-[#1a1a24] border rounded-2xl p-4 cursor-pointer transition-all hover:border-white/[0.1] ${!n.isRead?'border-l-indigo-500 border-l-2 border-white/[0.06]':'border-white/[0.04]'}`}><div className="flex items-start gap-3"><div className="w-9 h-9 rounded-xl bg-white/[0.03] flex items-center justify-center shrink-0">{icons[n.type]||<Bell size={13}/>}</div><div className="flex-1 min-w-0"><p className={`text-sm ${!n.isRead?'font-semibold text-white':'text-white/60'}`}>{n.message}</p><p className="text-[11px] text-white/35 mt-1">{n.createdAt?format(new Date(n.createdAt),'d MMM, HH:mm',{locale:ru}):''}</p></div>{!n.isRead&&<div className="w-2 h-2 rounded-full bg-indigo-500 shrink-0 mt-1.5"/>}</div></motion.div>)}</div>
      )}
    </div>
  );
}
