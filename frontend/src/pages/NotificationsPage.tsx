import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import api from '../api/axios';
import { Bell, Heart, MessageCircle, ShoppingBag, Gift, CheckCheck } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import toast from 'react-hot-toast';

const icons: Record<string, React.ReactNode> = {
  like: <Heart size={13} className="text-red-400" />,
  comment: <MessageCircle size={13} className="text-[#34d399]" />,
  order: <ShoppingBag size={13} className="text-[#22c55e]" />,
  referral: <Gift size={13} className="text-amber-400" />,
  broadcast: <Bell size={13} className="text-[#34d399]" />,
};

export default function NotificationsPage() {
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { api.get('/notifications').then(r => setList(r.data||[])).finally(() => setLoading(false)); }, []);

  const readAll = async () => { try { await api.patch('/notifications/read-all'); setList(p => p.map(n=>({...n,isRead:true}))); toast.success('Всё прочитано'); } catch { toast.error('Ошибка'); } };
  const markRead = async (id:string) => { try { await api.patch(`/notifications/${id}/read`); setList(p => p.map(n=>n.id===id?{...n,isRead:true}:n)); } catch { /* ignore */ } };

  if (loading) return <div className="flex justify-center py-32"><div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#22c55e] to-[#34d399] animate-pulse" /></div>;

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div className="fixed inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 60% 40% at 50% -5%, rgba(34,197,94,0.10) 0%, transparent 60%)'
      }} />

      <div className="relative max-w-2xl mx-auto px-4 sm:px-6 pt-10 pb-20">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Уведомления</h1>
          {list.some(n=>!n.isRead) && <button onClick={readAll} className="text-sm text-[#22c55e] hover:text-[#34d399] font-bold flex items-center gap-1"><CheckCheck size={14} /> Прочитать все</button>}
        </div>
        {list.length > 0 && <p className="text-[var(--color-muted)] text-sm mb-6">{list.filter(n=>!n.isRead).length} непрочитанных</p>}

        {list.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-20 h-20 rounded-full bg-[var(--color-surface)] flex items-center justify-center mb-6">
              <Bell size={32} className="text-[var(--color-faint)]" />
            </div>
            <p className="text-lg font-bold text-[var(--color-text)] mb-1">Пока тихо</p>
            <p className="text-[var(--color-muted)] text-sm">Лайки, комментарии и заказы будут тут</p>
          </div>
        ) : (
          <div className="space-y-2">
            {list.map((n,i) => (
              <motion.div
                key={n.id}
                initial={{opacity:0,x:-8}}
                animate={{opacity:1,x:0}}
                transition={{delay:i*0.02}}
                onClick={()=>!n.isRead&&markRead(n.id)}
                className={`rounded-2xl p-4 cursor-pointer transition-all bg-[var(--color-surface)] border ${!n.isRead ? 'border-[#22c55e]/40' : 'border-[var(--color-border)]'} hover:border-[#22c55e]/60`}
              >
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[var(--bg-3)] flex items-center justify-center shrink-0">{icons[n.type]||<Bell size={13}/>}</div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm ${!n.isRead?'font-bold text-[var(--color-text)]':'text-[var(--color-muted)]'}`}>{n.message}</p>
                    <p className="text-[11px] text-[var(--color-faint)] mt-1">{n.createdAt?format(new Date(n.createdAt),'d MMM, HH:mm',{locale:ru}):''}</p>
                  </div>
                  {!n.isRead && <div className="w-2 h-2 rounded-full bg-[#22c55e] shrink-0 mt-1.5"/>}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}