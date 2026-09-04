import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShoppingBag, Newspaper, MessageCircle, User, ArrowRight } from 'lucide-react';
import Card from '../components/ui/Card';

export default function DashboardPage() {
  const [userName, setUserName] = useState('');
  useEffect(() => {
    import('../api/users').then(m => m.getProfile().then(u => setUserName(u.name)));
  }, []);

  const actions = [
    { to: '/products', icon: ShoppingBag, label: 'Товары', desc: 'Покупайте и продавайте', grad: 'linear-gradient(135deg, #fbfbf8, #a8b0a8)' },
    { to: '/posts', icon: Newspaper, label: 'Лента', desc: 'Новости и реклама', grad: 'linear-gradient(135deg, #a8b0a8, #a8b0a8)' },
    { to: '/chat', icon: MessageCircle, label: 'Чат', desc: 'Общайтесь с продавцами', grad: 'linear-gradient(135deg, #a8b0a8, #fbfbf8)' },
    { to: '/profile', icon: User, label: 'Профиль', desc: 'Ваши данные и заказы', grad: 'linear-gradient(135deg, #fbfbf8, #a8b0a8)' },
  ];

  return (
    <div className="space-y-12">
      <div className="text-center pt-4">
        <h1 className="text-4xl font-bold tracking-tight">
          Добро пожаловать, <span className="text-gradient">{userName || '...'}</span>
        </h1>
        <p className="mt-4 text-lg text-[var(--color-muted)]">
          Ваш закрытый маркетплейс с чатом и новостями.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
        {actions.map(({ to, icon: Icon, label, desc, grad }) => (
          <Link key={to} to={to} className="group">
            <Card className="flex items-center gap-5 cursor-pointer group-hover:border-[rgba(201,242,103,0.4)]">
              <div className="p-3 rounded-2xl flex-shrink-0 shadow-lg" style={{ background: grad }}>
                <Icon className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-lg">{label}</h3>
                <p className="text-[var(--color-muted)] text-sm">{desc}</p>
              </div>
              <ArrowRight className="w-5 h-5 text-[var(--color-faint)] group-hover:text-[#fbfbf8] group-hover:translate-x-1 transition-all" />
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}