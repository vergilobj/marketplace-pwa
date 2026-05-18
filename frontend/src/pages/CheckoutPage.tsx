import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import { createOrder } from '../api/orders';
import toast from 'react-hot-toast';

export default function CheckoutPage() {
  const { cart, clearCart } = useApp();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const total = cart.reduce((s, i) => s + i.price * i.quantity, 0);

  const handleCheckout = async () => {
    setLoading(true);
    try {
      for (const item of cart) {
        await createOrder(item.productId, item.price * item.quantity);
      }
      clearCart();
      toast.success('Заказ оформлен!');
      navigate('/orders');
    } catch (e) {
      toast.error('Ошибка при оформлении заказа');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold">Оформление заказа</h1>
      <Card className="space-y-4">
        <h3 className="font-semibold">Ваш заказ</h3>
        {cart.map(item => (
          <div key={item.productId} className="flex justify-between text-sm">
            <span>{item.title} × {item.quantity}</span>
            <span>{(item.price * item.quantity).toLocaleString()} ₽</span>
          </div>
        ))}
        <hr />
        <div className="flex justify-between font-bold text-lg">
          <span>Итого</span>
          <span>{total.toLocaleString()} ₽</span>
        </div>
      </Card>
      <Button className="w-full" loading={loading} onClick={handleCheckout}>Подтвердить и оплатить</Button>
    </div>
  );
}