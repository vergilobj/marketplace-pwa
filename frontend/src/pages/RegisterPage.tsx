import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { register } from '../api/auth';
import { UserPlus, ArrowLeft } from 'lucide-react';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import { CometChat } from '@cometchat/chat-sdk-javascript';

// Замени на свой реальный Auth Key из панели CometChat
const COMETCHAT_AUTH_KEY = 'fdca52860f5a94590f8095c50743331726c12205';

export default function RegisterPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ phone: '', name: '', password: '', inviteCode: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { accessToken, refreshToken } = await register(
        form.phone,
        form.name,
        form.password,
        form.inviteCode
      );
      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('refreshToken', refreshToken);
      const payload = JSON.parse(atob(accessToken.split('.')[1]));
      const userId = payload.sub;
      localStorage.setItem('userId', userId);

      // OneSignal
      window.OneSignalDeferred?.push(async (OneSignal: any) => {
        await OneSignal.login(userId);
        await OneSignal.Notifications.requestPermission();
      });

      // CometChat: логинимся напрямую через SDK
      try {
        await CometChat.login(userId, COMETCHAT_AUTH_KEY);
        console.log('CometChat logged in');
      } catch (chatErr) {
        console.warn('CometChat login failed, will retry via CometChatInit', chatErr);
      }

      navigate('/');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Ошибка регистрации');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center">
      <div className="w-full max-w-md">
        <Link to="/" className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-8">
          <ArrowLeft size={16} className="mr-1" /> На главную
        </Link>
        <Card>
          <div className="text-center mb-8">
            <div className="mx-auto w-12 h-12 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center mb-4">
              <UserPlus className="w-6 h-6 text-blue-600" />
            </div>
            <h1 className="text-2xl font-bold">Создать аккаунт</h1>
            <p className="text-gray-500 dark:text-gray-400 mt-2">
              Требуется приглашение, чтобы присоединиться
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Телефон"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="+7 (999) 123-45-67"
              required
            />
            <Input
              label="Имя"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ваше имя"
              required
            />
            <Input
              label="Пароль"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="Не менее 6 символов"
              required
            />
            <Input
              label="Код приглашения"
              value={form.inviteCode}
              onChange={(e) => setForm({ ...form, inviteCode: e.target.value })}
              placeholder="INVITE-CODE"
              required
              error={error}
            />
            {error && <p className="text-sm text-red-500">{error}</p>}
            <Button type="submit" loading={loading} className="w-full">
              Зарегистрироваться
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-gray-500">
            Уже есть аккаунт?{' '}
            <Link to="/login" className="text-blue-600 font-medium hover:underline">
              Войти
            </Link>
          </p>
        </Card>
      </div>
    </div>
  );
}