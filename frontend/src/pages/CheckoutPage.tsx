import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useApp } from '../context/AppContext';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import toast from 'react-hot-toast';
import { createOrder } from '../api/orders';

const paymentMethods = [
  { id: 'card', label: 'Банковская карта', icon: '💳' },
  { id: 'cash', label: 'Наличные при получении', icon: '💵' },
  { id: 'bonus', label: 'Бонусы (реферальные)', icon: '🎁' },
];

export default function CheckoutPage() {
  const { cart, clearCart } = useApp();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('card');
  const [promoCode, setPromoCode] = useState('');
  const [discount, setDiscount] = useState(0);

  const total = cart.reduce((s, i) => s + i.price * i.quantity, 0);

  const handleCheckout = async () => {
    if (cart.length === 0) return;

    setLoading(true);
    try {
      // Создаём заказы последовательно
      for (const item of cart) {
        // Убедимся, что productId действительно передан
        if (!item.productId) {
          console.error('Missing productId in cart item', item);
          toast.error('Ошибка: неверный товар в корзине');
          return;
        }
        await createOrder(item.productId, item.price * item.quantity);
      }
      clearCart();
      toast.success('Заказ оформлен!');
      navigate('/orders');
    } catch (err: any) {
      console.error('Checkout error:', err);
      const message =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        'Ошибка при оформлении заказа';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const applyPromo = () => {
    if (promoCode.trim().toLowerCase() === 'welcome') {
      setDiscount(Math.round(total * 0.1));
      toast.success('Промокод применён (скидка 10%)');
    } else {
      toast.error('Неверный промокод');
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="max-w-xl mx-auto space-y-6"
    >
      <h1 className="text-3xl font-bold">Оформление заказа</h1>

      {/* Товары */}
      <Card>
        <h3 className="font-semibold mb-3">Ваш заказ</h3>
        <div className="space-y-2">
          {cart.map(item => (
            <div key={item.productId} className="flex justify-between text-sm">
              <span>{item.title} × {item.quantity}</span>
              <span>{(item.price * item.quantity).toLocaleString()} ₽</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Способ оплаты */}
      <Card>
        <h3 className="font-semibold mb-3">Способ оплаты</h3>
        <div className="space-y-2">
          {paymentMethods.map(m => (
            <label
              key={m.id}
              className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition ${
                paymentMethod === m.id
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-200 dark:border-gray-700'
              }`}
            >
              <input
                type="radio"
                name="payment"
                value={m.id}
                checked={paymentMethod === m.id}
                onChange={() => setPaymentMethod(m.id)}
                className="hidden"
              />
              <span className="text-lg">{m.icon}</span>
              <span className="text-sm font-medium">{m.label}</span>
            </label>
          ))}
        </div>
      </Card>

      {/* Промокод */}
      <Card>
        <h3 className="font-semibold mb-3">Промокод</h3>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Введите код"
            value={promoCode}
            onChange={e => setPromoCode(e.target.value)}
            className="flex-1 px-4 py-2 rounded-xl bg-gray-100 dark:bg-gray-800 border border-transparent focus:border-blue-500 outline-none text-sm"
          />
          <Button variant="secondary" size="sm" onClick={applyPromo}>
            Применить
          </Button>
        </div>
        {discount > 0 && (
          <p className="text-sm text-green-600 mt-2">
            Скидка: {discount.toLocaleString()} ₽
          </p>
        )}
      </Card>

      {/* Сводка */}
      <Card>
        <h3 className="font-semibold mb-3">Сводка</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span>Сумма заказа</span>
            <span>{total.toLocaleString()} ₽</span>
          </div>
          {discount > 0 && (
            <div className="flex justify-between text-green-600">
              <span>Скидка</span>
              <span>-{discount.toLocaleString()} ₽</span>
            </div>
          )}
          <hr />
          <div className="flex justify-between font-bold text-lg">
            <span>Итого</span>
            <span className="text-blue-600">
              {(total - discount).toLocaleString()} ₽
            </span>
          </div>
        </div>
      </Card>

      <Button
        className="w-full py-4 text-lg rounded-2xl"
        loading={loading}
        onClick={handleCheckout}
      >
        Подтвердить и оплатить
      </Button>
    </motion.div>
  );
}