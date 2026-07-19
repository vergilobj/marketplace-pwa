import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
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
const ChatPage = lazy(() => import('./pages/ChatPage'));
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

function Lazy({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="flex justify-center py-20"><div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" /></div>}>{children}</Suspense>;
}

function ProtectedRoute({ children, requiredRole }: { children: React.ReactNode; requiredRole?: string }) {
  const { isAuthenticated, user } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (requiredRole && user?.role !== requiredRole) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<FeedPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/privacy" element={<Lazy><PrivacyPage /></Lazy>} />
          <Route path="/products" element={<Lazy><ProductsPage /></Lazy>} />
          <Route path="/products/:id" element={<Lazy><ProductDetailPage /></Lazy>} />
          <Route path="/posts/:id" element={<Lazy><PostDetailPage /></Lazy>} />
          <Route path="/favorites" element={<Lazy><FavoritesPage /></Lazy>} />
          <Route path="/cart" element={<Lazy><CartPage /></Lazy>} />
          <Route path="/checkout" element={<ProtectedRoute><Lazy><CheckoutPage /></Lazy></ProtectedRoute>} />
          <Route path="/chat" element={<ProtectedRoute><Lazy><ChatPage /></Lazy></ProtectedRoute>} />
          <Route path="/orders" element={<ProtectedRoute><Lazy><OrdersPage /></Lazy></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><Lazy><ProfilePage /></Lazy></ProtectedRoute>} />
          <Route path="/notifications" element={<ProtectedRoute><Lazy><NotificationsPage /></Lazy></ProtectedRoute>} />
          <Route path="/referrals" element={<ProtectedRoute><Lazy><ReferralsPage /></Lazy></ProtectedRoute>} />
          <Route path="/withdrawals" element={<ProtectedRoute><Lazy><WithdrawalsPage /></Lazy></ProtectedRoute>} />
          <Route path="/products/new" element={<ProtectedRoute requiredRole="SELLER"><Lazy><CreateProductPage /></Lazy></ProtectedRoute>} />
          <Route path="/posts/ad/new" element={<ProtectedRoute requiredRole="SELLER"><Lazy><CreateAdPage /></Lazy></ProtectedRoute>} />
          <Route path="/admin" element={<ProtectedRoute requiredRole="ADMIN"><Lazy><AdminPage /></Lazy></ProtectedRoute>} />
          <Route path="/posts/new" element={<ProtectedRoute requiredRole="ADMIN"><Lazy><CreatePostPage /></Lazy></ProtectedRoute>} />
          <Route path="/posts/:id/edit" element={<ProtectedRoute requiredRole="ADMIN"><Lazy><EditPostPage /></Lazy></ProtectedRoute>} />
          <Route path="/my-products" element={<ProtectedRoute requiredRole="SELLER"><Lazy><MyProductsPage /></Lazy></ProtectedRoute>} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}