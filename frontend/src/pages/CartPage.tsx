import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Trash2, ShoppingBag, ArrowLeft } from 'lucide-react';
import { useApp } from '../context/AppContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';

export default function CartPage() {
  const { cart, removeFromCart, clearCart } = useApp();
  const navigate = useNavigate();

  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  if (cart.length === 0) return <EmptyState message="Корзина пуста" />;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Корзина</h1>
        <button onClick={clearCart} className="text-red-500 text-sm">Очистить всё</button>
      </div>
      <div className="space-y-4">
        {cart.map(item => (
          <Card key={item.productId} className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold">{item.title}</h3>
              <p className="text-sm text-gray-500">{item.price.toLocaleString()} ₽ × {item.quantity}</p>
            </div>
            <button onClick={() => removeFromCart(item.productId)} className="text-red-500"><Trash2 size={18} /></button>
          </Card>
        ))}
      </div>
      <div className="text-right text-xl font-bold">Итого: {total.toLocaleString()} ₽</div>
      <Button className="w-full" onClick={() => navigate('/checkout')}>
        <ShoppingBag size={18} className="mr-2" /> Оформить заказ
      </Button>
    </div>
  );
}