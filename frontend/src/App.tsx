import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import FeedPage from './pages/FeedPage';
import ProductDetailPage from './pages/ProductDetailPage';
import CreateProductPage from './pages/CreateProductPage';
import CartPage from './pages/CartPage';
import CheckoutPage from './pages/CheckoutPage';
import FavoritesPage from './pages/FavoritesPage';
import OrdersPage from './pages/OrdersPage';
import ProfilePage from './pages/ProfilePage';
import ChatPage from './pages/ChatPage';
import AdminPage from './pages/AdminPage';
import NotificationsPage from './pages/NotificationsPage';
import RegisterPage from './pages/RegisterPage';
import LoginPage from './pages/LoginPage';
import PrivacyPage from './pages/PrivacyPage';
import ReferralsPage from './pages/ReferralsPage';
import CreatePostPage from './pages/CreatePostPage';
import CreateAdPage from './pages/CreateAdPage';
import { useAuth } from './hooks/useAuth';

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
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/products/:id" element={<ProductDetailPage />} />
          <Route path="/favorites" element={<FavoritesPage />} />
          <Route path="/cart" element={<CartPage />} />

          <Route path="/checkout" element={<ProtectedRoute><CheckoutPage /></ProtectedRoute>} />
          <Route path="/chat" element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />
          <Route path="/orders" element={<ProtectedRoute><OrdersPage /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
          <Route path="/notifications" element={<ProtectedRoute><NotificationsPage /></ProtectedRoute>} />
          <Route path="/referrals" element={<ProtectedRoute><ReferralsPage /></ProtectedRoute>} />

          <Route path="/products/new" element={<ProtectedRoute requiredRole="SELLER"><CreateProductPage /></ProtectedRoute>} />
          <Route path="/posts/ad/new" element={<ProtectedRoute requiredRole="SELLER"><CreateAdPage /></ProtectedRoute>} />

          <Route path="/admin" element={<ProtectedRoute requiredRole="ADMIN"><AdminPage /></ProtectedRoute>} />
          <Route path="/posts/new" element={<ProtectedRoute requiredRole="ADMIN"><CreatePostPage /></ProtectedRoute>} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}