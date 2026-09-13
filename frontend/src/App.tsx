import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import Layout from './components/Layout';
import AccessDenied from './components/AccessDenied';
import { rememberAccessDenied } from './components/accessDeniedNotice';
import { useAuth } from './hooks/useAuth';

// Eager — critical path (first paint)
import FeedPage from './pages/FeedPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';

// Lazy — rest
const ProductDetailPage = lazy(() => import('./pages/ProductDetailPage'));
const CreateProductPage = lazy(() => import('./pages/CreateProductPage'));
const CartPage = lazy(() => import('./pages/CartPage'));
const CheckoutPage = lazy(() => import('./pages/CheckoutPage'));
const FavoritesPage = lazy(() => import('./pages/FavoritesPage'));
const OrdersPage = lazy(() => import('./pages/OrdersPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
// p2p-чат заменён на Базар (/bazar). Старая страница ChatPage удалена 2026-09-11.
const LeadsPage = lazy(() => import('./pages/LeadsPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'));
const ReferralsPage = lazy(() => import('./pages/ReferralsPage'));
const CreatePostPage = lazy(() => import('./pages/CreatePostPage'));
const CreateAdPage = lazy(() => import('./pages/CreateAdPage'));
const PostDetailPage = lazy(() => import('./pages/PostDetailPage'));
const WithdrawalsPage = lazy(() => import('./pages/WithdrawalsPage'));
const EditPostPage = lazy(() => import('./pages/EditPostPage'));
const MyProductsPage = lazy(() => import('./pages/MyProductsPage'));
const ProductsPage = lazy(() => import('./pages/ProductsPage'));
const BazarChatPage = lazy(() => import('./pages/BazarChatPage'));
const PublicProfilePage = lazy(() => import('./pages/PublicProfilePage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

function Lazy({ children }: { children: React.ReactNode }) {
  // PERF-4: фолбэк резервирует высоту экрана.
  // Раньше здесь был спиннер 32px в блоке py-20 (итого ~160px). Пока
  // лениво подгруженный чанк ехал, <main> был 344px высотой, футер стоял
  // в первом экране (y=456) — а когда страница отрисовывалась на всю
  // высоту, футер уезжал вниз. Замер CDP: один сдвиг 0.339 на FOOTER
  // (/posts/:id) и 0.439 (/products) — это и был остаточный CLS.
  // Теперь высота занята заранее → сдвига нет.
  return (
    <Suspense
      fallback={
        <div className="min-h-screen" role="status" aria-label="Загрузка">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-10">
            <div className="skeleton h-7 w-2/5 mb-3" />
            <div className="skeleton h-3.5 w-1/4" />
          </div>
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

/**
 * COSMETIC-2: сколько держим объяснение «раздел недоступен», прежде чем
 * молча уйти на главную. Раньше редирект был мгновенным и без причины.
 */
const ACCESS_DENIED_DWELL_MS = 5000;

/** Человеческий текст причины — по требуемой роли. */
function deniedReasonText(requiredRole?: string): string {
  return requiredRole === 'ADMIN'
    ? 'Раздел доступен только администраторам'
    : 'Раздел доступен только продавцам';
}

/** Заголовок заглушки: с каким именно разделом не пустили. */
function deniedTitle(requiredRole?: string): string {
  return requiredRole === 'ADMIN'
    ? 'Раздел только для администраторов'
    : 'Раздел только для продавцов';
}

function ProtectedRoute({ children, requiredRole }: { children: React.ReactNode; requiredRole?: string }) {
  const { isAuthenticated, user, rolePending, refresh } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  /**
   * BUG-2: роль в клейме access-токена статична. Если админ одобрил заявку
   * (или сменил роль напрямую), пока приложение открыто, токен остаётся
   * старым и requiredRole редиректил на `/`. Ре-фетчим серверную роль при
   * входе на защищённый роут.
   */
  useEffect(() => {
    if (!isAuthenticated) return;
    void refresh();
  }, [isAuthenticated, refresh, location.pathname]);

  /**
   * BUG-2: пользователь может получить роль, стоя на любой странице.
   * Ловим возврат фокуса/вкладки и подстраховываемся минутным опросом.
   * Здесь force=true: токен не менялся, но роль на сервере могла.
   */
  useEffect(() => {
    if (!isAuthenticated) return;
    const onFocus = () => void refresh(true);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh(true);
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(onFocus, 60000);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [isAuthenticated, refresh]);

  /**
   * COSMETIC-2: роль проверена и не подходит.
   *
   * Guard НЕ ослаблен — условие ровно то же, что было в старом редиректе
   * (`role !== requiredRole && role !== 'ADMIN'`), и children по-прежнему
   * не рендерятся: ни один компонент закрытого раздела не монтируется и
   * ни одного его запроса не уходит. Меняется только ИНФОРМИРОВАНИЕ:
   * вместо мгновенного молчаливого <Navigate to="/"> показываем объяснение
   * (адрес остаётся прежним) и через паузу уводим на главную, где лента
   * показывает тост с причиной.
   */
  const roleBlocked =
    !!requiredRole && !rolePending && user?.role !== requiredRole && user?.role !== 'ADMIN';

  useEffect(() => {
    if (!roleBlocked) return;
    const reason = deniedReasonText(requiredRole);
    // Причина уходит в sessionStorage: тост, показанный до анмаунта, не
    // переживает навигацию — его покажет лента на своей стороне.
    rememberAccessDenied({
      path: location.pathname,
      reason: requiredRole ?? '',
      message: `${reason}. Возвращаем на главную`,
    });
    const timer = window.setTimeout(() => {
      navigate('/', { replace: true });
    }, ACCESS_DENIED_DWELL_MS);
    return () => window.clearTimeout(timer);
  }, [roleBlocked, requiredRole, location.pathname, navigate]);

  // location.state.from — чтобы после логина вернуть юзера туда, откуда выкинуло.
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location }} />;
  /**
   * BUG-2: пока серверная роль не подтверждена, требуемую роль не проверяем —
   * иначе первый клик по /products/new выкинул бы BUYER'а на `/` раньше, чем
   * приедет ответ с новой ролью. Это НЕ ослабление guard'а: показывается
   * заглушка, страница не рендерится, и по приходу роли всё равно произойдёт
   * либо рендер, либо редирект.
   */
  if (requiredRole && rolePending) return <div className="min-h-screen" role="status" aria-label="Загрузка" />;
  if (roleBlocked)
    return (
      <AccessDenied
        title={deniedTitle(requiredRole)}
        description={`${deniedReasonText(requiredRole)}. Доступ к этому разделу закрыт — через несколько секунд вернём на главную.`}
      />
    );
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<FeedPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/signup" element={<RegisterPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/privacy" element={<Lazy><PrivacyPage /></Lazy>} />
          <Route path="/products" element={<Lazy><ProductsPage /></Lazy>} />
          <Route path="/products/:id" element={<Lazy><ProductDetailPage /></Lazy>} />
          <Route path="/posts/:id" element={<Lazy><PostDetailPage /></Lazy>} />
          <Route path="/favorites" element={<ProtectedRoute><Lazy><FavoritesPage /></Lazy></ProtectedRoute>} />
          <Route path="/cart" element={<ProtectedRoute><Lazy><CartPage /></Lazy></ProtectedRoute>} />
          <Route path="/checkout" element={<ProtectedRoute><Lazy><CheckoutPage /></Lazy></ProtectedRoute>} />
          {/* p2p-чат заменён на Базар (/bazar). Старая страница ChatPage удалена 2026-09-11. */}
          <Route path="/orders" element={<ProtectedRoute><Lazy><OrdersPage /></Lazy></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><Lazy><ProfilePage /></Lazy></ProtectedRoute>} />
          <Route path="/notifications" element={<ProtectedRoute><Lazy><NotificationsPage /></Lazy></ProtectedRoute>} />
          <Route path="/referrals" element={<ProtectedRoute><Lazy><ReferralsPage /></Lazy></ProtectedRoute>} />
          <Route path="/withdrawals" element={<ProtectedRoute><Lazy><WithdrawalsPage /></Lazy></ProtectedRoute>} />
          <Route path="/products/new" element={<ProtectedRoute requiredRole="SELLER"><Lazy><CreateProductPage /></Lazy></ProtectedRoute>} />
          <Route path="/posts/ad/new" element={<ProtectedRoute requiredRole="SELLER"><Lazy><CreateAdPage /></Lazy></ProtectedRoute>} />
          <Route path="/admin" element={<ProtectedRoute requiredRole="ADMIN"><Lazy><AdminPage /></Lazy></ProtectedRoute>} />
          <Route path="/posts/new" element={<ProtectedRoute><Lazy><CreatePostPage /></Lazy></ProtectedRoute>} />
          <Route path="/posts/:id/edit" element={<ProtectedRoute requiredRole="ADMIN"><Lazy><EditPostPage /></Lazy></ProtectedRoute>} />
          <Route path="/my-products" element={<ProtectedRoute requiredRole="SELLER"><Lazy><MyProductsPage /></Lazy></ProtectedRoute>} />
          <Route path="/bazar" element={<Lazy><BazarChatPage /></Lazy>} />
          {/* A5.8: публичный профиль пользователя (без телефона и баланса) */}
          <Route path="/users/:id" element={<Lazy><PublicProfilePage /></Lazy>} />
          <Route path="/leads" element={<ProtectedRoute requiredRole="SELLER"><Lazy><LeadsPage /></Lazy></ProtectedRoute>} />
          {/* 404 — обязательно последним в блоке роутов */}
          <Route path="*" element={<Lazy><NotFoundPage /></Lazy>} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}