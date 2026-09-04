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

const GS = { background: 'linear-gradient(135deg, #fbfbf8 0%, #a8b0a8 50%, #a8b0a8 100%)' } as const;

export default function Layout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const [lightMode, setLightMode] = useState(() => {
    const saved = localStorage.getItem('theme_v3');
    return saved === null ? true : saved === 'dark';
  });
  const navigate = useNavigate();
  const location = useLocation();
  const { cart } = useApp();
  const { isAuthenticated, isAdmin, isSeller, user } = useAuth();

  const profileMenuRef = useClickAway(() => setProfileMenuOpen(false));

  // Theme toggle — class-based: .dark = dark, отсутствие = светлая
  useEffect(() => {
    if (lightMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme_v3', lightMode ? 'dark' : 'light');
  }, [lightMode]);

  const handleLogout = () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('userId');
    window.OneSignal?.logout()?.catch(() => {});
    navigate('/login');
  };

  // Привязка external_user_id к устройству для push-уведомлений
  useEffect(() => {
    if (isAuthenticated && user?.id) {
      window.OneSignal?.login(String(user.id))?.catch(() => {});
    } else {
      window.OneSignal?.logout()?.catch(() => {});
    }
  }, [isAuthenticated, user?.id]);

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
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      <header className="sticky top-0 z-50 glass-strong border-b border-[var(--color-border)] shadow-[0_8px_30px_rgba(0,0,0,0.25)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
          <Link to="/" className="flex items-center gap-2.5 shrink-0 group">
            <div style={GS} className="w-8 h-8 rounded-[10px] flex items-center justify-center shadow-[0_8px_20px_rgba(201,242,103,0.35)] group-hover:scale-105 transition-transform">
              <ShoppingBag size={16} className="text-[#0b0e0d]" />
            </div>
            <span className="text-xl font-bold tracking-tight text-gradient">Базар</span>
          </Link>

          <form onSubmit={handleGlobalSearch} className="hidden md:flex items-center ml-8 flex-1 max-w-lg">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                placeholder="Поиск товаров и постов..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 rounded-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] focus:border-[rgba(201,242,103,0.5)] focus:ring-4 focus:ring-[rgba(201,242,103,0.1)] outline-none transition-all text-sm text-[var(--color-text)] placeholder:text-[var(--color-faint)]"
              />
            </div>
          </form>

          <nav className="hidden md:flex items-center space-x-1.5 ml-4">
            <button onClick={() => setLightMode(!lightMode)} className="p-2 rounded-full hover:bg-[rgba(255,255,255,0.06)] text-[var(--color-muted)] hover:text-[#fbfbf8] transition-colors" title={lightMode ? 'Тёмная тема' : 'Светлая тема'}>
              {lightMode ? <Moon size={20} /> : <Sun size={20} />}
            </button>
            <Link to="/favorites" className="p-2 rounded-full hover:bg-[rgba(255,255,255,0.06)] text-[var(--color-muted)] hover:text-[#fbfbf8] transition-colors">
              <Heart size={20} />
            </Link>
            <Link to="/cart" className="p-2 rounded-full hover:bg-[rgba(255,255,255,0.06)] text-[var(--color-muted)] hover:text-[#fbfbf8] transition-colors relative">
              <ShoppingBag size={20} />
              {cart.length > 0 && (
                <span style={GS} className="absolute -top-0.5 -right-0.5 text-[#0b0e0d] text-[10px] rounded-full w-4 h-4 flex items-center justify-center">{cart.length > 9 ? '9+' : cart.length}</span>
              )}
            </Link>
            {isAuthenticated && (
              <>
                <Link to="/chat" className="p-2 rounded-full hover:bg-[rgba(255,255,255,0.06)] text-[var(--color-muted)] hover:text-[#fbfbf8] transition-colors">
                  <MessageCircle size={20} />
                </Link>
                <Link to="/notifications" className="p-2 rounded-full hover:bg-[rgba(255,255,255,0.06)] text-[var(--color-muted)] hover:text-[#fbfbf8] transition-colors relative">
                  <Bell size={20} />
                  {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-[var(--color-text)] text-[10px] rounded-full w-4 h-4 flex items-center justify-center">{unreadCount > 9 ? '9+' : unreadCount}</span>
                  )}
                </Link>

                <div className="relative" ref={profileMenuRef}>
                  <button
                    onClick={() => setProfileMenuOpen(!profileMenuOpen)}
                    className="p-2 rounded-full hover:bg-[rgba(255,255,255,0.06)] text-[var(--color-muted)] hover:text-[#fbfbf8] transition-colors"
                  >
                    <User size={20} />
                  </button>
                  {profileMenuOpen && (
                    <div className="absolute right-0 top-full mt-2 w-60 glass-strong rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.5)] border border-[rgba(255,255,255,0.08)] py-2 z-50">
                      <Link to="/profile" className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-[rgba(255,255,255,0.05)] transition-colors" onClick={() => setProfileMenuOpen(false)}><User size={16} /> Профиль</Link>
                      <Link to="/orders" className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-[rgba(255,255,255,0.05)] transition-colors" onClick={() => setProfileMenuOpen(false)}><PackageCheck size={16} /> Мои заказы</Link>
                      <Link to="/favorites" className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-[rgba(255,255,255,0.05)] transition-colors" onClick={() => setProfileMenuOpen(false)}><Heart size={16} /> Избранное</Link>
                      <Link to="/referrals" className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-[rgba(255,255,255,0.05)] transition-colors" onClick={() => setProfileMenuOpen(false)}><Settings size={16} /> Рефералы</Link>
                      {isSeller && (
                       <>
                         <Link to="/products/new" className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-[rgba(255,255,255,0.05)] transition-colors" onClick={() => setProfileMenuOpen(false)}><PlusCircle size={16} /> Создать товар</Link>
                         <Link to="/my-products" className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-[rgba(255,255,255,0.05)] transition-colors" onClick={() => setProfileMenuOpen(false)}>Мои товары</Link>
                       </>
                      )}
                      {isAdmin && (
                        <Link to="/admin" className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-[rgba(255,255,255,0.05)] transition-colors" onClick={() => setProfileMenuOpen(false)}><Settings size={16} /> Админ-панель</Link>
                      )}
                      <hr className="my-2 border-[rgba(255,255,255,0.06)]" />
                      <button onClick={handleLogout} className="flex items-center gap-2 px-4 py-2.5 text-sm text-red-400 hover:bg-[rgba(255,255,255,0.05)] w-full transition-colors"><LogOut size={16} /> Выйти</button>
                    </div>
                  )}
                </div>
              </>
            )}
            {!isAuthenticated && (
              <Link to="/login" style={GS} className="px-5 py-2 rounded-full text-[#0b0e0d] text-sm font-semibold hover:scale-[1.04] transition-transform shadow-[0_8px_24px_rgba(201,242,103,0.35)]">Войти</Link>
            )}
          </nav>

          <button onClick={() => setMenuOpen(!menuOpen)} className="md:hidden p-2">
            {menuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>

        {menuOpen && (
          <div className="md:hidden px-4 pb-4 space-y-2 glass-strong">
            <form onSubmit={handleGlobalSearch} className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input type="text" placeholder="Поиск..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 rounded-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] focus:border-[rgba(201,242,103,0.5)] outline-none text-sm text-[var(--color-text)] placeholder:text-[var(--color-faint)]" />
            </form>
            {mobileLinks.map(item => (
              <Link key={item.to} to={item.to} className="block py-2 text-sm" onClick={() => setMenuOpen(false)}><item.icon size={18} className="inline mr-2" />{item.label}</Link>
            ))}
            {isAuthenticated && (<>
              <Link to="/orders" className="block py-2 text-sm" onClick={() => setMenuOpen(false)}>Мои заказы</Link>
              <Link to="/referrals" className="block py-2 text-sm" onClick={() => setMenuOpen(false)}>Рефералы</Link>
              {isSeller && <Link to="/products/new" className="block py-2 text-sm" onClick={() => setMenuOpen(false)}>Создать товар</Link>}
              {isAdmin && <Link to="/admin" className="block py-2 text-sm" onClick={() => setMenuOpen(false)}>Админ</Link>}
              <button onClick={handleLogout} className="block py-2 text-sm text-red-400 w-full text-left">Выйти</button>
            </>)}
            {!isAuthenticated && <Link to="/login" className="block py-2 text-sm text-[#fbfbf8]" onClick={() => setMenuOpen(false)}>Войти</Link>}
          </div>
        )}
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 pb-24 md:pb-10">
        <PageTransition><Outlet /></PageTransition>
      </main>

      <footer className="border-t border-[rgba(255,255,255,0.06)] glass py-12 px-4">
        <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8">
          <div>
            <h3 className="font-bold text-lg mb-4">Базар</h3>
            <p className="text-[var(--color-muted)] text-sm leading-relaxed">Закрытый маркетплейс для проверенных участников.</p>
          </div>
          <div>
            <h4 className="font-semibold text-sm mb-3">Навигация</h4>
            <div className="space-y-2">
              <Link to="/" className="block text-[var(--color-muted)] text-sm hover:text-[#fbfbf8] transition-colors">Главная</Link>
              <Link to="/products" className="block text-[var(--color-muted)] text-sm hover:text-[#fbfbf8] transition-colors">Товары</Link>
              <Link to="/favorites" className="block text-[var(--color-muted)] text-sm hover:text-[#fbfbf8] transition-colors">Избранное</Link>
              <Link to="/cart" className="block text-[var(--color-muted)] text-sm hover:text-[#fbfbf8] transition-colors">Корзина</Link>
            </div>
          </div>
          <div>
            <h4 className="font-semibold text-sm mb-3">Сервис</h4>
            <div className="space-y-2">
              <Link to="/privacy" className="block text-[var(--color-muted)] text-sm hover:text-[#fbfbf8] transition-colors">Приватность</Link>
              <Link to="/chat" className="block text-[var(--color-muted)] text-sm hover:text-[#fbfbf8] transition-colors">Чат</Link>
              <Link to="/referrals" className="block text-[var(--color-muted)] text-sm hover:text-[#fbfbf8] transition-colors">Рефералы</Link>
            </div>
          </div>
          <div>
            <h4 className="font-semibold text-sm mb-3">Контакты</h4>
            <div className="space-y-2">
              <p className="text-[var(--color-muted)] text-sm">support@bazar.ru</p>
              <p className="text-[var(--color-muted)] text-sm">8 (800) 123-45-67</p>
            </div>
          </div>
        </div>
        <div className="max-w-7xl mx-auto mt-8 pt-8 border-t border-[rgba(255,255,255,0.05)] text-center">
          <p className="text-[var(--color-faint)] text-xs">2026 Базар. Все права защищены.</p>
        </div>
      </footer>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 glass-strong border-t border-[rgba(255,255,255,0.06)] flex justify-around py-2 z-40">
        {mobileLinks.map(item => {
          const isActive = location.pathname === item.to;
          return (
            <Link key={item.to} to={item.to} className={`flex flex-col items-center text-xs ${isActive ? 'text-[#fbfbf8]' : 'text-[var(--color-muted)]'}`}>
              <item.icon size={20} /><span className="mt-1">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}