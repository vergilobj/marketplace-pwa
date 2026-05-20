import React from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Trash2, ShoppingBag, ArrowLeft, Heart, Minus, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useApp } from '../context/AppContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';

export default function CartPage() {
  const { cart, removeFromCart, updateQuantity, moveToFavorites, clearCart } = useApp();
  const navigate = useNavigate();

  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  if (cart.length === 0) return <EmptyState message="Корзина пуста" />;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Корзина</h1>
        <button onClick={clearCart} className="text-sm text-red-500 hover:text-red-600">
          Очистить всё
        </button>
      </div>
      <div className="space-y-4">
        <AnimatePresence>
          {cart.map(item => (
            <motion.div
              key={item.productId}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
            >
              <Card className="flex items-center justify-between">
                <div className="flex-1">
                  <h3 className="font-semibold">{item.title}</h3>
                  <p className="text-sm text-gray-500">{item.price.toLocaleString()} ₽</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
                    <motion.button
                      whileTap={{ scale: 0.9 }}
                      onClick={() => updateQuantity(item.productId, -1)}
                      className="p-1.5 rounded-lg hover:bg-white dark:hover:bg-gray-700"
                    >
                      <Minus size={14} />
                    </motion.button>
                    <span className="w-6 text-center text-sm font-medium">{item.quantity}</span>
                    <motion.button
                      whileTap={{ scale: 0.9 }}
                      onClick={() => updateQuantity(item.productId, 1)}
                      className="p-1.5 rounded-lg hover:bg-white dark:hover:bg-gray-700"
                    >
                      <Plus size={14} />
                    </motion.button>
                  </div>
                  <span className="font-bold text-blue-600 w-24 text-right">
                    {(item.price * item.quantity).toLocaleString()} ₽
                  </span>
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={() => moveToFavorites(item.productId)}
                    className="p-1.5 text-gray-400 hover:text-red-500"
                    title="Отложить в избранное"
                  >
                    <Heart size={16} />
                  </motion.button>
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={() => removeFromCart(item.productId)}
                    className="p-1.5 text-gray-400 hover:text-red-500"
                  >
                    <Trash2 size={16} />
                  </motion.button>
                </div>
              </Card>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <div className="flex justify-between items-center text-lg font-bold">
        <span>Итого:</span>
        <span className="text-2xl text-blue-600">{total.toLocaleString()} ₽</span>
      </div>
      <Button className="w-full py-4 text-lg rounded-2xl" onClick={() => navigate('/checkout')}>
        <ShoppingBag size={20} className="mr-2" /> Оформить заказ
      </Button>
      <div className="text-center">
        <Link to="/" className="text-sm text-blue-600 hover:underline">
          Продолжить покупки
        </Link>
      </div>
    </div>
  );
}