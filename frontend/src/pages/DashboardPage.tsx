import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShoppingBag, Newspaper, MessageCircle, User, ArrowRight } from 'lucide-react';

export default function DashboardPage() {
  const [userName, setUserName] = useState('');
  useEffect(() => {
    import('../api/users').then(m => m.getProfile().then(u => setUserName(u.name)));
  }, []);

  const actions = [
    { to: '/products', icon: ShoppingBag, label: 'Товары', desc: 'Покупай и продавай' },
    { to: '/posts', icon: Newspaper, label: 'Лента', desc: 'Новости и реклама' },
    { to: '/chat', icon: MessageCircle, label: 'Чат', desc: 'Свои рядом' },
    { to: '/profile', icon: User, label: 'Профиль', desc: 'Ты и заказы' },
  ];

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div className="fixed inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 60% 40% at 50% -5%, rgba(34,197,94,0.10) 0%, transparent 60%)'
      }} />

      <div className="relative max-w-3xl mx-auto px-4 sm:px-6 pt-10 pb-20">
        <div className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-2 h-2 rounded-full bg-[#22c55e] animate-pulse" />
            <span className="text-[11px] uppercase tracking-[0.3em] text-[var(--color-muted)]">ты внутри</span>
          </div>
          <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight text-[var(--color-text)]">
            Добро пожаловать,<br />
            <span style={{ background: 'linear-gradient(90deg, #22c55e, #34d399)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>{userName || 'свой'}</span>
          </h1>
          <p className="mt-4 text-[var(--color-muted)] text-base">Закрытый рынок с чатом и новостями — всё для тех, кто внутри.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {actions.map(({ to, icon: Icon, label, desc }) => (
            <Link key={to} to={to} className="group flex items-center gap-4 p-5 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] hover:border-[#22c55e]/40 transition-colors">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center text-[#22c55e] shrink-0" style={{ background: 'rgba(34,197,94,0.1)' }}>
                <Icon size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-[var(--color-text)]">{label}</div>
                <div className="text-[var(--color-muted)] text-sm">{desc}</div>
              </div>
              <ArrowRight size={18} className="text-[var(--color-faint)] group-hover:text-[#22c55e] group-hover:translate-x-1 transition-all shrink-0" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}