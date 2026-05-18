import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShoppingBag, Newspaper, MessageCircle, User, ArrowRight } from 'lucide-react';
import Card from '../components/ui/Card';

export default function DashboardPage() {
  const [userName, setUserName] = useState('');
  useEffect(() => {
    import('../api/users').then(m => m.getProfile().then(u => setUserName(u.name)));
  }, []);

  const actions = [
    { to: '/products', icon: ShoppingBag, label: 'Товары', desc: 'Покупайте и продавайте' },
    { to: '/posts', icon: Newspaper, label: 'Лента', desc: 'Новости и реклама' },
    { to: '/chat', icon: MessageCircle, label: 'Чат', desc: 'Общайтесь с продавцами' },
    { to: '/profile', icon: User, label: 'Профиль', desc: 'Ваши данные и заказы' },
  ];

  return (
    <div className="space-y-12">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">Добро пожаловать, {userName || '...'}</h1>
        <p className="mt-4 text-lg text-gray-500 dark:text-gray-400">
          Ваш закрытый маркетплейс с чатом и новостями.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
        {actions.map(({ to, icon: Icon, label, desc }) => (
          <Link key={to} to={to} className="group">
            <Card className="flex items-center gap-5 group-hover:border-blue-500/30 transition-colors cursor-pointer">
              <div className="p-3 bg-blue-100 dark:bg-blue-900 rounded-2xl">
                <Icon className="w-6 h-6 text-blue-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-lg">{label}</h3>
                <p className="text-gray-500 dark:text-gray-400 text-sm">{desc}</p>
              </div>
              <ArrowRight className="w-5 h-5 text-gray-300 group-hover:text-blue-500 transition-colors" />
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}