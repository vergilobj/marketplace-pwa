import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Megaphone } from 'lucide-react';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import { createAd } from '../api/posts';

export default function CreateAdPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ title: '', content: '', days: 3 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await createAd({ title: form.title, content: form.content, days: form.days });
      navigate('/');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Ошибка при создании рекламы');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto">
      <button onClick={() => navigate(-1)} className="flex items-center text-sm text-gray-500 mb-6">
        <ArrowLeft size={16} className="mr-1" /> Назад
      </button>
      <Card>
        <div className="flex items-center gap-3 mb-6">
          <Megaphone className="w-6 h-6 text-orange-500" />
          <h1 className="text-2xl font-bold">Рекламный пост</h1>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input label="Заголовок" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required />
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Текст</label>
            <textarea
              value={form.content}
              onChange={e => setForm({ ...form, content: e.target.value })}
              rows={3}
              className="w-full px-4 py-3 rounded-xl bg-gray-100 dark:bg-gray-800 border border-transparent focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
              required
            />
          </div>
          <Input label="Дней размещения" type="number" value={form.days} onChange={e => setForm({ ...form, days: parseInt(e.target.value) || 1 })} min={1} required />
          {error && <p className="text-red-500">{error}</p>}
          <Button type="submit" loading={loading} className="w-full">Оплатить и разместить</Button>
        </form>
      </Card>
    </div>
  );
}