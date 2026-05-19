import React, { useEffect, useState } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import {
  ShoppingBag, MessageCircle, User, LogOut, Menu, X, PackageCheck, Heart, Home, Bell
} from 'lucide-react';
import api from '../api/axios';
import { useApp } from '../context/AppContext';
import { useAuth } from '../hooks/useAuth';

const navItems = [
  { to: '/', icon: Home, label: 'Лента', authRequired: false },
  { to: '/favorites', icon: Heart, label: 'Избранное', authRequired: false },
  { to: '/cart', icon: ShoppingBag, label: 'Корзина', authRequired: false },
  { to: '/chat', icon: MessageCircle, label: 'Чат', authRequired: true },
  { to: '/profile', icon: User, label: 'Профиль', authRequired: true },
];

export default function Layout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();
  const { cart } = useApp();
  const { isAuthenticated, isAdmin, isSeller } = useAuth();

  const handleLogout = () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('userId');
    navigate('/login');
  };

  useEffect(() => {
    if (isAuthenticated) {
      api.get('/notifications/unread-count')
        .then(r => setUnreadCount(r.data.count))
        .catch(() => {});
    }
  }, [isAuthenticated, location.pathname]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 text-gray-900 dark:text-white font-sans">
      <header className="sticky top-0 z-50 bg-white/70 dark:bg-gray-900/70 backdrop-blur-xl border-b border-gray-200/50 dark:border-gray-800/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
          <Link to="/" className="text-xl font-bold tracking-tight">Marketplace</Link>
          <nav className="hidden md:flex items-center space-x-6">
            <Link to="/" className="text-sm font-medium hover:text-blue-600">Главная</Link>
            <Link to="/favorites" className="text-sm font-medium hover:text-blue-600">Избранное</Link>
            <Link to="/cart" className="text-sm font-medium hover:text-blue-600 relative">
              Корзина
              {cart.length > 0 && (
                <span className="absolute -top-1 -right-2 bg-blue-600 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center">
                  {cart.length > 9 ? '9+' : cart.length}
                </span>
              )}
            </Link>
            {isAuthenticated ? (
              <>
                <Link to="/chat" className="text-sm font-medium hover:text-blue-600">Чат</Link>
                <Link to="/orders" className="text-sm font-medium hover:text-blue-600">Заказы</Link>
                <Link to="/notifications" className="relative text-sm font-medium hover:text-blue-600">
                  <Bell size={18} />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-2 bg-red-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </Link>
                <Link to="/profile" className="text-sm font-medium hover:text-blue-600">Профиль</Link>
                {isAdmin && <Link to="/admin" className="text-sm font-medium hover:text-blue-600">Админ</Link>}
                <button onClick={handleLogout} className="text-sm font-medium text-red-500 hover:text-red-600">Выйти</button>
              </>
            ) : (
              <Link to="/login" className="text-sm font-medium text-blue-600">Войти</Link>
            )}
          </nav>
          <button onClick={() => setMenuOpen(!menuOpen)} className="md:hidden p-2">
            {menuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
        {menuOpen && (
          <div className="md:hidden px-4 pb-4 space-y-2 bg-white/90 dark:bg-gray-900/90">
            {navItems.map(item => (
              (!item.authRequired || isAuthenticated) && (
                <Link key={item.to} to={item.to} className="block py-2 text-sm">{item.label}</Link>
              )
            ))}
            {isAuthenticated && (
              <>
                <Link to="/notifications" className="block py-2 text-sm">Уведомления</Link>
                <Link to="/orders" className="block py-2 text-sm">Заказы</Link>
                {isAdmin && <Link to="/admin" className="block py-2 text-sm">Админ</Link>}
                <button onClick={handleLogout} className="block py-2 text-sm text-red-500">Выйти</button>
              </>
            )}
            {!isAuthenticated && <Link to="/login" className="block py-2 text-sm text-blue-600">Войти</Link>}
          </div>
        )}
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 pb-24 md:pb-10">
        <Outlet />
      </main>
      {/* Bottom Nav Mobile */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border-t border-gray-200/50 dark:border-gray-800/50 flex justify-around py-2 z-40">
        {navItems.map(item => {
          if (item.authRequired && !isAuthenticated) return null;
          const isActive = location.pathname === item.to;
          return (
            <Link key={item.to} to={item.to} className={`flex flex-col items-center text-xs ${isActive ? 'text-blue-600' : 'text-gray-500'}`}>
              <item.icon size={20} />
              <span className="mt-1">{item.label}</span>
              {item.to === '/cart' && cart.length > 0 && (
                <span className="absolute -mt-1 ml-3 bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px]">{cart.length}</span>
              )}
            </Link>
          );
        })}
        {isAuthenticated && (
          <Link to="/notifications" className={`flex flex-col items-center text-xs ${location.pathname === '/notifications' ? 'text-blue-600' : 'text-gray-500'}`}>
            <Bell size={20} />
            <span className="mt-1">Уведомления</span>
          </Link>
        )}
      </nav>
    </div>
  );
}