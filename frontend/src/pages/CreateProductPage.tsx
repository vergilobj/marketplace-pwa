import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, PackagePlus } from 'lucide-react';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import { createProduct } from '../api/products';

export default function CreateProductPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ title: '', description: '', price: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await createProduct({ title: form.title, description: form.description, price: parseFloat(form.price) });
      navigate('/products');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Ошибка');
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
          <PackagePlus className="w-6 h-6 text-blue-600" />
          <h1 className="text-2xl font-bold">Новый товар</h1>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input label="Название" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required />
          <Input label="Описание" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          <Input label="Цена (₽)" type="number" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} required />
          {error && <p className="text-red-500">{error}</p>}
          <Button type="submit" loading={loading} className="w-full">Создать товар</Button>
        </form>
      </Card>
    </div>
  );
}