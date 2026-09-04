import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, PackagePlus, ImagePlus, X } from 'lucide-react';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import { createProduct } from '../api/products';
import { uploadImage } from '../api/upload';

export default function CreateProductPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ title: '', description: '', price: '' });
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    setFiles(prev => [...prev, ...selected]);
    selected.forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreviews(prev => [...prev, reader.result as string]);
      };
      reader.readAsDataURL(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
    setPreviews(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const uploadedUrls: string[] = [];
      for (const file of files) {
        const url = await uploadImage(file);
        uploadedUrls.push(url);
      }

      await createProduct({
        title: form.title,
        description: form.description,
        price: parseFloat(form.price),
        media: uploadedUrls,
      });

      navigate('/products');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Ошибка при создании товара');
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

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Фотографии</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {previews.map((src, idx) => (
                <div key={idx} className="relative w-20 h-20 rounded-lg overflow-hidden">
                  <img src={src} alt={`preview ${idx}`} className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removeFile(idx)}
                    className="absolute top-0 right-0 bg-black/60 text-[var(--color-text)] rounded-full w-5 h-5 flex items-center justify-center"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
            >
              <ImagePlus size={16} /> Добавить фото
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          {error && <p className="text-red-500">{error}</p>}
          <Button type="submit" loading={loading} className="w-full">Создать товар</Button>
        </form>
      </Card>
    </div>
  );
}