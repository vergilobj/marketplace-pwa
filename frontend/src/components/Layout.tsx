import React, { useEffect, useState, useRef } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import {
  ShoppingBag, MessageCircle, User, LogOut, Menu, X, PackageCheck, Heart, Home, Bell,
  Search, PlusCircle, Settings, Sun, Moon
} from 'lucide-react';
import api from '../api/axios';
import { useApp } from '../context/AppContext';
import { useAuth } from '../hooks/useAuth';
import PageTransition from './PageTransition';

function useClickAway(callback: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) callback();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [callback]);
  return ref;
}

export default function Layout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const [lightMode, setLightMode] = useState(() => localStorage.getItem('theme') === 'light');
  const navigate = useNavigate();
  const location = useLocation();
  const { cart } = useApp();
  const { isAuthenticated, isAdmin, isSeller } = useAuth();

  const profileMenuRef = useClickAway(() => setProfileMenuOpen(false));

  // Theme toggle
  useEffect(() => {
    if (lightMode) {
      document.documentElement.style.filter = 'invert(1) hue-rotate(180deg)';
      document.documentElement.style.transition = 'filter 0.3s';
    } else {
      document.documentElement.style.filter = '';
    }
    localStorage.setItem('theme', lightMode ? 'light' : 'dark');
  }, [lightMode]);

  const handleLogout = () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('userId');
    navigate('/login');
  };

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isAuthenticated) {
      const fetchUnread = () => {
        api.get('/notifications/unread-count').then(r => setUnreadCount(r.data.count)).catch(() => {});
      };
      fetchUnread();
      interval = setInterval(fetchUnread, 30000);
    }
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  const handleGlobalSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/?search=${encodeURIComponent(searchQuery.trim())}`);
      setSearchQuery('');
    }
  };

  const mobileLinks = [
    { to: '/', icon: Home, label: 'Главная' },
    { to: '/favorites', icon: Heart, label: 'Избранное' },
    { to: '/cart', icon: ShoppingBag, label: 'Корзина' },
  ];
  if (isAuthenticated) {
    mobileLinks.push({ to: '/chat', icon: MessageCircle, label: 'Чат' });
    mobileLinks.push({ to: '/notifications', icon: Bell, label: 'Уведомления' });
    mobileLinks.push({ to: '/profile', icon: User, label: 'Профиль' });
  }

  return (
    <div className="min-h-screen bg-[#f8f9fc] dark:bg-[#0a0a0f] text-gray-900 dark:text-white">
      <header className="sticky top-0 z-50 bg-white/80 dark:bg-[#0a0a0f]/80 backdrop-blur-xl border-b border-gray-200 dark:border-white/[0.06]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
          <Link to="/" className="text-xl font-bold tracking-tight shrink-0">Marketplace</Link>

          <form onSubmit={handleGlobalSearch} className="hidden md:flex items-center ml-8 flex-1 max-w-lg">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                placeholder="Поиск товаров и постов..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 rounded-xl bg-gray-100 dark:bg-gray-800 border border-transparent focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all text-sm"
              />
            </div>
          </form>

          <nav className="hidden md:flex items-center space-x-2 ml-4">
            <button onClick={() => setLightMode(!lightMode)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-500 dark:text-white/50 hover:text-indigo-500 transition-colors" title={lightMode ? 'Тёмная тема' : 'Светлая тема'}>
              {lightMode ? <Moon size={20} /> : <Sun size={20} />}
            </button>
            <Link to="/favorites" className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-500 dark:text-white/50 hover:text-indigo-500">
              <Heart size={20} />
            </Link>
            <Link to="/cart" className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-500 dark:text-white/50 hover:text-indigo-500 relative">
              <ShoppingBag size={20} />
              {cart.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-indigo-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center">
                  {cart.length > 9 ? '9+' : cart.length}
                </span>
              )}
            </Link>
            {isAuthenticated && (
              <>
                <Link to="/chat" className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-500 dark:text-white/50 hover:text-indigo-500">
                  <MessageCircle size={20} />
                </Link>
                <Link to="/notifications" className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-500 dark:text-white/50 hover:text-indigo-500 relative">
                  <Bell size={20} />
                  {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </Link>

                <div className="relative" ref={profileMenuRef}>
                  <button
                    onClick={() => setProfileMenuOpen(!profileMenuOpen)}
                    className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-500 dark:text-white/50 hover:text-indigo-500"
                  >
                    <User size={20} />
                  </button>
                  {profileMenuOpen && (
                    <div className="absolute right-0 top-full mt-1 w-56 bg-white dark:bg-[#1a1a24] rounded-xl shadow-lg border border-gray-200 dark:border-white/[0.06] py-1 z-50">
                      <Link to="/profile" className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-gray-50 dark:hover:bg-white/[0.04]" onClick={() => setProfileMenuOpen(false)}><User size={16} /> Профиль</Link>
                      <Link to="/orders" className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-gray-50 dark:hover:bg-white/[0.04]" onClick={() => setProfileMenuOpen(false)}><PackageCheck size={16} /> Мои заказы</Link>
                      <Link to="/favorites" className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-gray-50 dark:hover:bg-white/[0.04]" onClick={() => setProfileMenuOpen(false)}><Heart size={16} /> Избранное</Link>
                      <Link to="/referrals" className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-gray-50 dark:hover:bg-white/[0.04]" onClick={() => setProfileMenuOpen(false)}><Settings size={16} /> Рефералы</Link>
                      {isSeller && (
                       <>
                         <Link to="/products/new" className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-gray-50 dark:hover:bg-white/[0.04]" onClick={() => setProfileMenuOpen(false)}><PlusCircle size={16} /> Создать товар</Link>
                         <Link to="/my-products" className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-gray-50 dark:hover:bg-white/[0.04]" onClick={() => setProfileMenuOpen(false)}>Мои товары</Link>
                       </>
                      )}
                      {isAdmin && (
                        <Link to="/admin" className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-gray-50 dark:hover:bg-white/[0.04]" onClick={() => setProfileMenuOpen(false)}><Settings size={16} /> Админ-панель</Link>
                      )}
                      <hr className="my-1 border-gray-200 dark:border-white/[0.06]" />
                      <button onClick={handleLogout} className="flex items-center gap-2 px-4 py-2 text-sm text-red-500 hover:bg-gray-50 dark:hover:bg-white/[0.04] w-full"><LogOut size={16} /> Выйти</button>
                    </div>
                  )}
                </div>
              </>
            )}
            {!isAuthenticated && (
              <Link to="/login" className="px-4 py-2 rounded-xl bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-400 transition">Войти</Link>
            )}
          </nav>

          <button onClick={() => setMenuOpen(!menuOpen)} className="md:hidden p-2">
            {menuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>

        {menuOpen && (
          <div className="md:hidden px-4 pb-4 space-y-2 bg-white/90 dark:bg-[#0a0a0f]/90">
            <form onSubmit={handleGlobalSearch} className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input type="text" placeholder="Поиск..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 rounded-xl bg-gray-100 dark:bg-gray-800 border border-transparent focus:border-indigo-500 outline-none text-sm" />
            </form>
            {mobileLinks.map(item => (
              <Link key={item.to} to={item.to} className="block py-2 text-sm" onClick={() => setMenuOpen(false)}><item.icon size={18} className="inline mr-2" />{item.label}</Link>
            ))}
            {isAuthenticated && (<>
              <Link to="/orders" className="block py-2 text-sm" onClick={() => setMenuOpen(false)}>Мои заказы</Link>
              <Link to="/referrals" className="block py-2 text-sm" onClick={() => setMenuOpen(false)}>Рефералы</Link>
              {isSeller && <Link to="/products/new" className="block py-2 text-sm" onClick={() => setMenuOpen(false)}>Создать товар</Link>}
              {isAdmin && <Link to="/admin" className="block py-2 text-sm" onClick={() => setMenuOpen(false)}>Админ</Link>}
              <button onClick={handleLogout} className="block py-2 text-sm text-red-500 w-full text-left">Выйти</button>
            </>)}
            {!isAuthenticated && <Link to="/login" className="block py-2 text-sm text-indigo-500" onClick={() => setMenuOpen(false)}>Войти</Link>}
          </div>
        )}
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 pb-24 md:pb-10">
        <PageTransition><Outlet /></PageTransition>
      </main>

      <footer className="border-t border-gray-200 dark:border-white/[0.06] bg-white dark:bg-[#0a0a0f] py-12 px-4">
        <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8">
          <div>
            <h3 className="font-bold text-lg mb-4">Marketplace</h3>
            <p className="text-gray-500 dark:text-white/40 text-sm leading-relaxed">Закрытый маркетплейс для проверенных участников.</p>
          </div>
          <div>
            <h4 className="font-semibold text-sm mb-3">Навигация</h4>
            <div className="space-y-2">
              <Link to="/" className="block text-gray-500 dark:text-white/40 text-sm hover:text-indigo-500 transition-colors">Главная</Link>
              <Link to="/products" className="block text-gray-500 dark:text-white/40 text-sm hover:text-indigo-500 transition-colors">Товары</Link>
              <Link to="/favorites" className="block text-gray-500 dark:text-white/40 text-sm hover:text-indigo-500 transition-colors">Избранное</Link>
              <Link to="/cart" className="block text-gray-500 dark:text-white/40 text-sm hover:text-indigo-500 transition-colors">Корзина</Link>
            </div>
          </div>
          <div>
            <h4 className="font-semibold text-sm mb-3">Сервис</h4>
            <div className="space-y-2">
              <Link to="/privacy" className="block text-gray-500 dark:text-white/40 text-sm hover:text-indigo-500 transition-colors">Приватность</Link>
              <Link to="/chat" className="block text-gray-500 dark:text-white/40 text-sm hover:text-indigo-500 transition-colors">Чат</Link>
              <Link to="/referrals" className="block text-gray-500 dark:text-white/40 text-sm hover:text-indigo-500 transition-colors">Рефералы</Link>
            </div>
          </div>
          <div>
            <h4 className="font-semibold text-sm mb-3">Контакты</h4>
            <div className="space-y-2">
              <p className="text-gray-500 dark:text-white/40 text-sm">support@marketplace.ru</p>
              <p className="text-gray-500 dark:text-white/40 text-sm">8 (800) 123-45-67</p>
            </div>
          </div>
        </div>
        <div className="max-w-7xl mx-auto mt-8 pt-8 border-t border-gray-100 dark:border-white/[0.04] text-center">
          <p className="text-gray-400 dark:text-white/20 text-xs">2026 Marketplace PWA. Все права защищены.</p>
        </div>
      </footer>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white/80 dark:bg-[#0a0a0f]/80 backdrop-blur-xl border-t border-gray-200 dark:border-white/[0.06] flex justify-around py-2 z-40">
        {mobileLinks.map(item => {
          const isActive = location.pathname === item.to;
          return (
            <Link key={item.to} to={item.to} className={`flex flex-col items-center text-xs ${isActive ? 'text-indigo-500' : 'text-gray-500'}`}>
              <item.icon size={20} /><span className="mt-1">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
