import React, { useEffect, useState } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { ShoppingBag, User, Heart, Bell, Search, X, Home, Sparkles, Inbox, LayoutGrid } from 'lucide-react';
import api from '../api/axios';
import { useApp } from '../context/AppContext';
import { useAuth } from '../hooks/useAuth';
import PageTransition from './PageTransition';
import { CreateMenu } from './CreateMenu';
import { isNavActive } from './navActive';

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

  const isSeller = user?.role === 'SELLER' || user?.role === 'ADMIN';

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      <header className="sticky top-3 z-50 px-4">
        <div className="max-w-5xl mx-auto flex items-center gap-2 h-16 px-3.5 rounded-2xl bg-[rgba(17,25,24,0.72)] backdrop-blur-xl border border-[rgba(255,255,255,0.08)] shadow-[0_8px_32px_-8px_rgba(0,0,0,0.5)] relative">
          {/* Логотип */}
          {/* R14: лого было 36px высотой — тач-зона ≥44px */}
          <Link to="/" className={`${searchOpen ? 'hidden' : 'flex'} items-center gap-2.5 shrink-0 group min-h-[44px]`}>
            <img src="/logo.webp" alt="Базар" width={96} height={96} loading="eager" decoding="async" className="w-9 h-9 rounded-xl object-cover group-hover:scale-105 transition-transform" />
            <span className="text-lg font-extrabold tracking-tight text-[var(--color-text)]">Базар</span>
          </Link>

          {/* Плавно выезжающее поле поиска — оверлей поверх всего хидера */}
          <div
            className={`absolute inset-0 flex items-center px-4 bg-[rgba(17,25,24,0.95)] backdrop-blur-xl rounded-2xl transition-all duration-300 ease-out z-10 ${searchOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
            aria-hidden={!searchOpen}
          >
            <form onSubmit={handleGlobalSearch} className="relative w-full">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-faint)]" size={17} />
              <input
                autoFocus={searchOpen}
                type="text"
                placeholder="Что ищем?"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                tabIndex={searchOpen ? 0 : -1}
                className="w-full h-11 pl-10 pr-12 rounded-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.08)] focus:border-[#22c55e] outline-none transition-all text-sm text-[var(--color-text)] placeholder:text-[var(--color-faint)]"
              />
              {/* R15: скрытая кнопка закрытия не должна быть в tab-порядке */}
              {/* R14: визуально 32×32, тач-зона 44×44 */}
              <button
                type="button"
                onClick={() => setSearchOpen(false)}
                tabIndex={searchOpen ? 0 : -1}
                aria-hidden={!searchOpen}
                aria-label="Закрыть поиск"
                className="absolute right-0.5 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center"
              >
                <span className="w-8 h-8 rounded-full bg-[#22c55e] text-[#0b0e0d] flex items-center justify-center"><X size={16} /></span>
              </button>
            </form>
          </div>

          {/* Иконки-действия — только десктоп, справа */}
          <nav className={`hidden sm:flex items-center gap-1.5 shrink-0 ml-auto transition-all duration-300 ${searchOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
            {isAuthenticated && <CreateMenu variant="icon" />}
            {/* R9: каталог доступен из десктопной шапки */}
            <DesktopIcon to="/products" title="Каталог"><LayoutGrid size={18} /></DesktopIcon>
            <DesktopIcon to="/bazar" title="Базар"><Sparkles size={18} /></DesktopIcon>
            <DesktopIcon to="/favorites" title="Избранное"><Heart size={18} /></DesktopIcon>
            <DesktopIcon to="/cart" title="Корзина">
              <ShoppingBag size={18} />
              {cart.length > 0 && (
                <span style={GS} className="absolute -top-0.5 -right-0.5 text-[#0b0e0d] text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">{cart.length > 9 ? '9+' : cart.length}</span>
              )}
            </DesktopIcon>
            {isAuthenticated && (
              <>
                {isSeller && (
                  <DesktopIcon to="/leads" title="Лиды"><Inbox size={18} /></DesktopIcon>
                )}
                <DesktopIcon to="/notifications" title="Уведомления">
                  <Bell size={18} />
                  {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">{unreadCount > 9 ? '9+' : unreadCount}</span>
                  )}
                </DesktopIcon>
                <DesktopIcon to="/profile" title="Профиль"><User size={18} /></DesktopIcon>
              </>
            )}
          </nav>

          {/* Кнопка поиска — справа, тянет вправо */}
          <button
            onClick={() => setSearchOpen(!searchOpen)}
            tabIndex={searchOpen ? -1 : 0}
            aria-hidden={searchOpen}
            className={`shrink-0 ml-auto sm:ml-0 w-11 h-11 rounded-full flex items-center justify-center transition-colors ${searchOpen ? 'opacity-0 pointer-events-none' : ''} bg-[rgba(255,255,255,0.04)] text-[var(--color-muted)] hover:bg-[rgba(255,255,255,0.08)] hover:text-[#22c55e]`}
            title="Поиск"
          >
            <Search size={18} />
          </button>

          {/* Войти — крайняя справа, видна всегда */}
          {!isAuthenticated && (
            <Link to="/login" style={GS} className={`shrink-0 px-4 min-h-[44px] rounded-full text-[#0b0e0d] text-sm font-bold hover:scale-[1.04] transition-all flex items-center justify-center whitespace-nowrap ${searchOpen ? 'opacity-0 pointer-events-none' : ''}`}>Войти</Link>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 pb-28 md:pb-10">
        <PageTransition><Outlet /></PageTransition>
      </main>

      <footer className="mt-12 border-t border-[rgba(255,255,255,0.06)] px-4 pt-12 pb-24 md:pb-12">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
          <div className="flex items-center gap-3">
            <img src="/logo.webp" alt="Базар" width={96} height={96} loading="lazy" decoding="async" className="w-12 h-12 rounded-2xl object-cover" />
            <div>
              <div className="text-xl font-extrabold tracking-tight text-[var(--color-text)]">Базар</div>
              <div className="text-[12px] text-[var(--color-muted)]">закрытая площадка. только для своих.</div>
            </div>
          </div>

          {/* R14: ссылки были 20px высотой — тач-зона ≥44px, визуально те же */}
          <nav className="flex flex-wrap gap-x-5 gap-y-0 text-sm -my-2">
            <Link to="/products" className="tap-link px-1 text-[var(--color-muted)] hover:text-[#22c55e] transition-colors">Товары</Link>
            <Link to="/favorites" className="tap-link px-1 text-[var(--color-muted)] hover:text-[#22c55e] transition-colors">Избранное</Link>
            <Link to="/cart" className="tap-link px-1 text-[var(--color-muted)] hover:text-[#22c55e] transition-colors">Корзина</Link>
            <Link to="/bazar" className="tap-link px-1 text-[var(--color-muted)] hover:text-[#22c55e] transition-colors">Базар</Link>
            <Link to="/privacy" className="tap-link px-1 text-[var(--color-muted)] hover:text-[#22c55e] transition-colors">Приватность</Link>
          </nav>
        </div>

        <div className="max-w-5xl mx-auto mt-8 pt-6 border-t border-[rgba(255,255,255,0.05)] flex items-center justify-between text-[11px] text-[var(--color-faint)]">
          <span>2026 Базар</span>
          <span>support@bazar.ru</span>
        </div>
      </footer>

      <nav
        aria-label="Основная навигация"
        className="md:hidden fixed bottom-3 left-3 right-3 bg-[rgba(17,25,24,0.88)] backdrop-blur-xl border border-[rgba(255,255,255,0.08)] rounded-2xl flex justify-around items-center py-2 z-40 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.6)]"
      >
        <MobileTab to="/" icon={<Home size={20} />} label="Главная" pathname={location.pathname} />
        <MobileTab to="/bazar" icon={<Sparkles size={20} />} label="Базар" pathname={location.pathname} />
        <MobileTab to="/favorites" icon={<Heart size={20} />} label="Избран." pathname={location.pathname} />
        <CreateMenu variant="nav" />
        <MobileTab
          to="/cart"
          icon={
            <>
              <ShoppingBag size={20} />
              {cart.length > 0 && <span className="absolute -top-1 right-4 bg-[#22c55e] text-[#0b0e0d] text-[9px] font-bold rounded-full min-w-4 h-4 px-0.5 flex items-center justify-center">{cart.length > 9 ? '9+' : cart.length}</span>}
            </>
          }
          label="Корзина"
          pathname={location.pathname}
        />
        {isAuthenticated ? (
          <>
            {/* R8: «Лиды» ушли в десктопную шапку/профиль, на их место — «Уведомления» (доступны всем, не только продавцам) */}
            <MobileTab
              to="/notifications"
              icon={
                <>
                  <Bell size={20} />
                  {unreadCount > 0 && <span className="absolute -top-1 right-3 bg-red-500 text-white text-[9px] font-bold rounded-full min-w-4 h-4 px-0.5 flex items-center justify-center">{unreadCount > 9 ? '9+' : unreadCount}</span>}
                </>
              }
              label="Уведом."
              pathname={location.pathname}
            />
            <MobileTab to="/profile" icon={<User size={20} />} label="Профиль" pathname={location.pathname} />
          </>
        ) : (
          <MobileTab to="/login" icon={<User size={20} />} label="Войти" pathname={location.pathname} />
        )}
      </nav>
    </div>
  );
}

/** Десктопная иконка-ссылка с active-состоянием */
function DesktopIcon({ to, title, children }: { to: string; title: string; children: React.ReactNode }) {
  const { pathname } = useLocation();
  const active = isNavActive(pathname, to);
  return (
    <Link
      to={to}
      title={title}
      aria-current={active ? 'page' : undefined}
      data-nav-active={active ? 'true' : undefined}
      className={`w-11 h-11 rounded-full transition-colors flex items-center justify-center relative ${
        active
          ? 'bg-[rgba(34,197,94,0.12)] text-[#22c55e]'
          : 'bg-[rgba(255,255,255,0.04)] text-[var(--color-muted)] hover:bg-[rgba(255,255,255,0.08)] hover:text-[#22c55e]'
      }`}
    >
      {children}
    </Link>
  );
}

/** Мобильный таб с надёжным active-состоянием */
function MobileTab({ to, icon, label, pathname }: { to: string; icon: React.ReactNode; label: string; pathname: string }) {
  const active = isNavActive(pathname, to);
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      data-nav-active={active ? 'true' : undefined}
      className={`flex flex-col items-center justify-center min-w-0 flex-1 min-h-[44px] text-[10px] relative ${active ? 'text-[#22c55e]' : 'text-[var(--color-muted)]'}`}
    >
      <span className="relative flex items-center justify-center">{icon}</span>
      <span className="tab-label mt-0.5 block">{label}</span>
    </Link>
  );
}