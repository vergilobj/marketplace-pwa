import React, { useEffect, useState, useRef } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import {
  ShoppingBag, MessageCircle, User, LogOut, Menu, X, PackageCheck, Heart, Home, Bell,
  Search, PlusCircle, Settings
} from 'lucide-react';
import api from '../api/axios';
import { useApp } from '../context/AppContext';
import { useAuth } from '../hooks/useAuth';

// Хук для закрытия по клику вне элемента
function useClickAway(callback: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        callback();
      }
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
  const navigate = useNavigate();
  const location = useLocation();
  const { cart } = useApp();
  const { isAuthenticated, isAdmin, isSeller } = useAuth();

  const profileMenuRef = useClickAway(() => setProfileMenuOpen(false));

  const handleLogout = () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('userId');
    navigate('/login');
  };

  // Unread count polling
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isAuthenticated) {
      const fetchUnread = () => {
        api.get('/notifications/unread-count')
          .then(r => setUnreadCount(r.data.count))
          .catch(() => {});
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

  // Мобильные ссылки
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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 text-gray-900 dark:text-white font-sans">
      <header className="sticky top-0 z-50 bg-white/70 dark:bg-gray-900/70 backdrop-blur-xl border-b border-gray-200/50 dark:border-gray-800/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
          {/* Logo */}
          <Link to="/" className="text-xl font-bold tracking-tight shrink-0">Marketplace</Link>

          {/* Search bar (desktop) */}
          <form onSubmit={handleGlobalSearch} className="hidden md:flex items-center ml-8 flex-1 max-w-lg">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                placeholder="Поиск товаров и постов..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 rounded-xl bg-gray-100 dark:bg-gray-800 border border-transparent focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all text-sm"
              />
            </div>
          </form>

          {/* Desktop navigation */}
          <nav className="hidden md:flex items-center space-x-2 ml-4">
            <Link to="/favorites" className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 hover:text-blue-600">
              <Heart size={20} />
            </Link>
            <Link to="/cart" className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 hover:text-blue-600 relative">
              <ShoppingBag size={20} />
              {cart.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-blue-600 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center">
                  {cart.length > 9 ? '9+' : cart.length}
                </span>
              )}
            </Link>
            {isAuthenticated && (
              <>
                <Link to="/chat" className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 hover:text-blue-600">
                  <MessageCircle size={20} />
                </Link>
                <Link to="/notifications" className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 hover:text-blue-600 relative">
                  <Bell size={20} />
                  {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </Link>

                {/* Profile dropdown */}
                <div className="relative" ref={profileMenuRef}>
                  <button
                    onClick={() => setProfileMenuOpen(!profileMenuOpen)}
                    className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 hover:text-blue-600"
                  >
                    <User size={20} />
                  </button>
                  {profileMenuOpen && (
                    <div className="absolute right-0 top-full mt-1 w-56 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50">
                      <Link to="/profile" className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700" onClick={() => setProfileMenuOpen(false)}>
                        <User size={16} /> Профиль
                      </Link>
                      <Link to="/orders" className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700" onClick={() => setProfileMenuOpen(false)}>
                        <PackageCheck size={16} /> Мои заказы
                      </Link>
                      <Link to="/favorites" className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700" onClick={() => setProfileMenuOpen(false)}>
                        <Heart size={16} /> Избранное
                      </Link>
                      <Link to="/referrals" className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700" onClick={() => setProfileMenuOpen(false)}>
                        <Settings size={16} /> Рефералы
                      </Link>
                      {isSeller && (
                        <Link to="/products/new" className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700" onClick={() => setProfileMenuOpen(false)}>
                          <PlusCircle size={16} /> Создать товар
                        </Link>
                      )}
                      {isAdmin && (
                        <Link to="/admin" className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700" onClick={() => setProfileMenuOpen(false)}>
                          <Settings size={16} /> Админ-панель
                        </Link>
                      )}
                      <hr className="my-1 border-gray-200 dark:border-gray-700" />
                      <button onClick={handleLogout} className="flex items-center gap-2 px-4 py-2 text-sm text-red-500 hover:bg-gray-100 dark:hover:bg-gray-700 w-full">
                        <LogOut size={16} /> Выйти
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
            {!isAuthenticated && (
              <Link to="/login" className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition">
                Войти
              </Link>
            )}
          </nav>

          {/* Mobile menu button */}
          <button onClick={() => setMenuOpen(!menuOpen)} className="md:hidden p-2">
            {menuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div className="md:hidden px-4 pb-4 space-y-2 bg-white/90 dark:bg-gray-900/90">
            <form onSubmit={handleGlobalSearch} className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                placeholder="Поиск..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 rounded-xl bg-gray-100 dark:bg-gray-800 border border-transparent focus:border-blue-500 outline-none text-sm"
              />
            </form>
            {mobileLinks.map(item => (
              <Link key={item.to} to={item.to} className="block py-2 text-sm" onClick={() => setMenuOpen(false)}>
                <item.icon size={18} className="inline mr-2" />{item.label}
              </Link>
            ))}
            {isAuthenticated && (
              <>
                <Link to="/orders" className="block py-2 text-sm" onClick={() => setMenuOpen(false)}>📦 Мои заказы</Link>
                <Link to="/referrals" className="block py-2 text-sm" onClick={() => setMenuOpen(false)}>👥 Рефералы</Link>
                {isSeller && <Link to="/products/new" className="block py-2 text-sm" onClick={() => setMenuOpen(false)}>➕ Создать товар</Link>}
                {isAdmin && <Link to="/admin" className="block py-2 text-sm" onClick={() => setMenuOpen(false)}>⚙️ Админ</Link>}
                <button onClick={handleLogout} className="block py-2 text-sm text-red-500 w-full text-left">🚪 Выйти</button>
              </>
            )}
            {!isAuthenticated && <Link to="/login" className="block py-2 text-sm text-blue-600" onClick={() => setMenuOpen(false)}>Войти</Link>}
          </div>
        )}
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 pb-24 md:pb-10">
        <Outlet />
      </main>

      {/* Mobile bottom navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border-t border-gray-200/50 dark:border-gray-800/50 flex justify-around py-2 z-40">
        {mobileLinks.map(item => {
          const isActive = location.pathname === item.to;
          return (
            <Link key={item.to} to={item.to} className={`flex flex-col items-center text-xs ${isActive ? 'text-blue-600' : 'text-gray-500'}`}>
              <item.icon size={20} />
              <span className="mt-1">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}