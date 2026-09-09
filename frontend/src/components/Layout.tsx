import React, { useEffect, useState } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { ShoppingBag, User, Heart, Bell, Search, X, Home, Sparkles, Inbox } from 'lucide-react';
import api from '../api/axios';
import { useApp } from '../context/AppContext';
import { useAuth } from '../hooks/useAuth';
import PageTransition from './PageTransition';

const GS = { background: '#22c55e' } as const;

export default function Layout() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();
  const { cart } = useApp();
  const { isAuthenticated, user } = useAuth();

  // Скролл наверх при переходе ВПЕРЁД, но не при возврате назад.
  // Кастомный кэш скролла ленты хранится в sessionStorage под ключом feed_scroll —
  // при возврате на ленту он восстанавливается, поэтому наверх не скроллим.
  useEffect(() => {
    if (!sessionStorage.getItem('feed_scroll')) {
      window.scrollTo(0, 0);
    }
  }, [location.pathname]);

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

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      <header className="sticky top-3 z-50 px-4">
        <div className="max-w-3xl mx-auto flex items-center gap-2 h-16 px-3.5 rounded-2xl bg-[rgba(17,25,24,0.72)] backdrop-blur-xl border border-[rgba(255,255,255,0.08)] shadow-[0_8px_32px_-8px_rgba(0,0,0,0.5)] relative">
          {/* Логотип */}
          <Link to="/" className={`${searchOpen ? 'hidden' : 'flex'} items-center gap-2.5 shrink-0 group`}>
            <img src="/logo.webp" alt="Базар" className="w-9 h-9 rounded-xl object-cover group-hover:scale-105 transition-transform" />
            <span className="text-lg font-extrabold tracking-tight text-[var(--color-text)]">Базар</span>
          </Link>

          {/* Плавно выезжающее поле поиска — оверлей поверх всего хидера */}
          <div className={`absolute inset-0 flex items-center px-4 bg-[rgba(17,25,24,0.95)] backdrop-blur-xl rounded-2xl transition-all duration-300 ease-out z-10 ${searchOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
            <form onSubmit={handleGlobalSearch} className="relative w-full">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-faint)]" size={17} />
              <input
                autoFocus
                type="text"
                placeholder="Что ищем?"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-11 pl-10 pr-12 rounded-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.08)] focus:border-[#22c55e] outline-none transition-all text-sm text-[var(--color-text)] placeholder:text-[var(--color-faint)]"
              />
              <button
                type="button"
                onClick={() => setSearchOpen(false)}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-[#22c55e] text-[#0b0e0d] flex items-center justify-center"
              >
                <X size={16} />
              </button>
            </form>
          </div>

          {/* Иконки-действия — только десктоп, справа */}
          <nav className={`hidden sm:flex items-center gap-1.5 shrink-0 ml-auto transition-all duration-300 ${searchOpen ? 'opacity-0' : 'opacity-100'}`}>
            <Link to="/bazar" className="w-10 h-10 rounded-full bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.08)] text-[var(--color-muted)] hover:text-[#22c55e] transition-colors flex items-center justify-center">
              <Sparkles size={18} />
            </Link>
            <Link to="/favorites" className="w-10 h-10 rounded-full bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.08)] text-[var(--color-muted)] hover:text-[#22c55e] transition-colors flex items-center justify-center">
              <Heart size={18} />
            </Link>
            <Link to="/cart" className="w-10 h-10 rounded-full bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.08)] text-[var(--color-muted)] hover:text-[#22c55e] transition-colors flex items-center justify-center relative">
              <ShoppingBag size={18} />
              {cart.length > 0 && (
                <span style={GS} className="absolute -top-0.5 -right-0.5 text-[#0b0e0d] text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">{cart.length > 9 ? '9+' : cart.length}</span>
              )}
            </Link>
            {isAuthenticated && (
              <>
                {user?.role === 'SELLER' || user?.role === 'ADMIN' ? (
                  <Link to="/leads" title="Лиды" className="w-10 h-10 rounded-full bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.08)] text-[var(--color-muted)] hover:text-[#22c55e] transition-colors flex items-center justify-center">
                    <Inbox size={18} />
                  </Link>
                ) : null}
                <Link to="/notifications" className="w-10 h-10 rounded-full bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.08)] text-[var(--color-muted)] hover:text-[#22c55e] transition-colors flex items-center justify-center relative">
                  <Bell size={18} />
                  {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">{unreadCount > 9 ? '9+' : unreadCount}</span>
                  )}
                </Link>
                <Link to="/profile" className="w-10 h-10 rounded-full bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.08)] text-[var(--color-muted)] hover:text-[#22c55e] transition-colors flex items-center justify-center" title="Профиль">
                  <User size={18} />
                </Link>
              </>
            )}
          </nav>

          {/* Кнопка поиска — справа, тянет вправо */}
          <button
            onClick={() => setSearchOpen(!searchOpen)}
            className={`shrink-0 ml-auto sm:ml-0 w-10 h-10 rounded-full flex items-center justify-center transition-colors ${searchOpen ? 'opacity-0 pointer-events-none' : ''} ${searchOpen ? 'bg-[#22c55e] text-[#0b0e0d]' : 'bg-[rgba(255,255,255,0.04)] text-[var(--color-muted)] hover:bg-[rgba(255,255,255,0.08)] hover:text-[#22c55e]'}`}
            title="Поиск"
          >
            <Search size={18} />
          </button>

          {/* Войти — крайняя справа, видна всегда */}
          {!isAuthenticated && (
            <Link to="/login" style={GS} className={`shrink-0 px-4 h-10 rounded-full text-[#0b0e0d] text-sm font-bold hover:scale-[1.04] transition-all flex items-center justify-center whitespace-nowrap ${searchOpen ? 'opacity-0 pointer-events-none' : ''}`}>Войти</Link>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 pb-24 md:pb-10">
        <PageTransition><Outlet /></PageTransition>
      </main>

      <footer className="mt-12 border-t border-[rgba(255,255,255,0.06)] px-4 pt-12 pb-24 md:pb-12">
        <div className="max-w-3xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
          <div className="flex items-center gap-3">
            <img src="/logo.webp" alt="Базар" className="w-12 h-12 rounded-2xl object-cover" />
            <div>
              <div className="text-xl font-extrabold tracking-tight text-[var(--color-text)]">Базар</div>
              <div className="text-[12px] text-[var(--color-muted)]">закрытая площадка. только для своих.</div>
            </div>
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Link to="/products" className="text-[var(--color-muted)] hover:text-[#22c55e] transition-colors">Товары</Link>
            <Link to="/favorites" className="text-[var(--color-muted)] hover:text-[#22c55e] transition-colors">Избранное</Link>
            <Link to="/cart" className="text-[var(--color-muted)] hover:text-[#22c55e] transition-colors">Корзина</Link>
            <Link to="/bazar" className="text-[var(--color-muted)] hover:text-[#22c55e] transition-colors">Базар</Link>
            <Link to="/privacy" className="text-[var(--color-muted)] hover:text-[#22c55e] transition-colors">Приватность</Link>
          </div>
        </div>

        <div className="max-w-3xl mx-auto mt-8 pt-6 border-t border-[rgba(255,255,255,0.05)] flex items-center justify-between text-[11px] text-[var(--color-faint)]">
          <span>2026 Базар</span>
          <span>support@bazar.ru</span>
        </div>
      </footer>

      <nav className="md:hidden fixed bottom-3 left-3 right-3 bg-[rgba(17,25,24,0.88)] backdrop-blur-xl border border-[rgba(255,255,255,0.08)] rounded-2xl flex justify-around py-2 z-40 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.6)]">
        <Link to="/" className={`flex flex-col items-center text-[11px] ${location.pathname === '/' ? 'text-[#22c55e]' : 'text-[var(--color-muted)]'}`}>
          <Home size={20} /><span className="mt-0.5">Главная</span>
        </Link>
        <Link to="/bazar" className={`flex flex-col items-center text-[11px] ${location.pathname === '/bazar' ? 'text-[#22c55e]' : 'text-[var(--color-muted)]'}`}>
          <Sparkles size={20} /><span className="mt-0.5">Базар</span>
        </Link>
        <Link to="/favorites" className={`flex flex-col items-center text-[11px] ${location.pathname === '/favorites' ? 'text-[#22c55e]' : 'text-[var(--color-muted)]'}`}>
          <Heart size={20} /><span className="mt-0.5">Избранное</span>
        </Link>
        <Link to="/cart" className={`flex flex-col items-center text-[11px] relative ${location.pathname === '/cart' ? 'text-[#22c55e]' : 'text-[var(--color-muted)]'}`}>
          <ShoppingBag size={20} />
          {cart.length > 0 && <span className="absolute -top-1 right-4 bg-[#22c55e] text-[#0b0e0d] text-[9px] font-bold rounded-full min-w-4 h-4 px-0.5 flex items-center justify-center">{cart.length > 9 ? '9+' : cart.length}</span>}
          <span className="mt-0.5">Корзина</span>
        </Link>
        {isAuthenticated && (
          <>
            {user?.role === 'SELLER' || user?.role === 'ADMIN' ? (
              <Link to="/leads" className={`flex flex-col items-center text-[11px] ${location.pathname === '/leads' ? 'text-[#22c55e]' : 'text-[var(--color-muted)]'}`}>
                <Inbox size={20} /><span className="mt-0.5">Лиды</span>
              </Link>
            ) : null}
            <Link to="/profile" className={`flex flex-col items-center text-[11px] ${location.pathname === '/profile' ? 'text-[#22c55e]' : 'text-[var(--color-muted)]'}`}>
              <User size={20} /><span className="mt-0.5">Профиль</span>
            </Link>
          </>
        )}
        {!isAuthenticated && (
          <Link to="/login" className={`flex flex-col items-center text-[11px] ${location.pathname === '/login' ? 'text-[#22c55e]' : 'text-[var(--color-muted)]'}`}>
            <User size={20} /><span className="mt-0.5">Войти</span>
          </Link>
        )}
      </nav>
    </div>
  );
}