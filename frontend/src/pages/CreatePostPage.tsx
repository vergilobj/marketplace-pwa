import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText, ImagePlus, X, Video } from 'lucide-react';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import { createPost } from '../api/posts';
import { uploadImage } from '../api/upload';

export default function CreatePostPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ title: '', content: '', link: '', videoUrl: '' });
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
      reader.onloadend = () => setPreviews(prev => [...prev, reader.result as string]);
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

      await createPost({
        title: form.title,
        content: form.content,
        link: form.link || undefined,
        videoUrl: form.videoUrl || undefined,
        media: uploadedUrls.length > 0 ? uploadedUrls : undefined,
      });

      navigate('/');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Ошибка при создании поста');
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
          <FileText className="w-6 h-6 text-blue-600" />
          <h1 className="text-2xl font-bold">Новый пост</h1>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input label="Заголовок" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required />
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Текст</label>
            <textarea
              value={form.content}
              onChange={e => setForm({ ...form, content: e.target.value })}
              rows={4}
              className="w-full px-4 py-3 rounded-xl bg-gray-100 dark:bg-gray-800 border border-transparent focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
              required
            />
          </div>
          <Input label="Ссылка (необязательно)" value={form.link} onChange={e => setForm({ ...form, link: e.target.value })} />
          <Input label="Видео URL (YouTube/Vimeo)" value={form.videoUrl} onChange={e => setForm({ ...form, videoUrl: e.target.value })} />

          {/* Загрузка фото */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Изображения</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {previews.map((src, idx) => (
                <div key={idx} className="relative w-20 h-20 rounded-lg overflow-hidden">
                  <img src={src} alt={`preview ${idx}`} className="w-full h-full object-cover" />
                  <button type="button" onClick={() => removeFile(idx)} className="absolute top-0 right-0 bg-black/60 text-white rounded-full w-5 h-5 flex items-center justify-center">
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700">
              <ImagePlus size={16} /> Добавить фото
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleFileChange} className="hidden" />
          </div>

          {error && <p className="text-red-500">{error}</p>}
          <Button type="submit" loading={loading} className="w-full">Опубликовать</Button>
        </form>
      </Card>
    </div>
  );
}