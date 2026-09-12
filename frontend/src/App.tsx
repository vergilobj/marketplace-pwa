import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
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

function ProtectedRoute({ children, requiredRole }: { children: React.ReactNode; requiredRole?: string }) {
  const { isAuthenticated, user } = useAuth();
  const location = useLocation();
  // location.state.from — чтобы после логина вернуть юзера туда, откуда выкинуло.
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location }} />;
  if (requiredRole && user?.role !== requiredRole && user?.role !== 'ADMIN') return <Navigate to="/" replace />;
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