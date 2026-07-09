import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText, ImagePlus, X } from 'lucide-react';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import api from '../api/axios';
import { uploadImage } from '../api/upload';
import toast from 'react-hot-toast';

export default function EditPostPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [form, setForm] = useState({ title: '', content: '', link: '', videoUrl: '' });
  const [existingMedia, setExistingMedia] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (id) {
      api.get(`/posts/${id}`).then(res => {
        const post = res.data;
        setForm({
          title: post.title,
          content: post.content || '',
          link: post.link || '',
          videoUrl: post.videoUrl || '',
        });
        setExistingMedia(post.media || []);
      }).finally(() => setLoading(false));
    }
  }, [id]);

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

  const removeExistingMedia = (index: number) => {
    setExistingMedia(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      // Загружаем новые фото
      const uploadedUrls: string[] = [];
      for (const file of files) {
        const url = await uploadImage(file);
        uploadedUrls.push(url);
      }
      const allMedia = [...existingMedia, ...uploadedUrls];

      await api.patch(`/posts/${id}`, {
        title: form.title,
        content: form.content,
        link: form.link || undefined,
        videoUrl: form.videoUrl || undefined,
        media: allMedia.length > 0 ? allMedia : undefined,
      });
      toast.success('Пост обновлён');
      navigate(`/posts/${id}`);
    } catch (_err) {
      toast.error('Ошибка при сохранении');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-center py-10 text-gray-500">Загрузка...</p>;

  return (
    <div className="max-w-xl mx-auto">
      <button onClick={() => navigate(-1)} className="flex items-center text-sm text-gray-500 mb-6">
        <ArrowLeft size={16} className="mr-1" /> Назад
      </button>
      <Card>
        <div className="flex items-center gap-3 mb-6">
          <FileText className="w-6 h-6 text-blue-600" />
          <h1 className="text-2xl font-bold">Редактировать пост</h1>
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
            />
          </div>
          <Input label="Ссылка (необязательно)" value={form.link} onChange={e => setForm({ ...form, link: e.target.value })} />
          <Input label="Видео URL" value={form.videoUrl} onChange={e => setForm({ ...form, videoUrl: e.target.value })} />

          {/* Существующие медиа */}
          {existingMedia.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Текущие изображения</label>
              <div className="flex flex-wrap gap-2">
                {existingMedia.map((url, idx) => (
                  <div key={idx} className="relative w-20 h-20 rounded-lg overflow-hidden">
                    <img src={url} alt="" className="w-full h-full object-cover" />
                    <button type="button" onClick={() => removeExistingMedia(idx)} className="absolute top-0 right-0 bg-black/60 text-white rounded-full w-5 h-5 flex items-center justify-center"><X size={12} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Новые фото */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Добавить фото</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {previews.map((src, idx) => (
                <div key={idx} className="relative w-20 h-20 rounded-lg overflow-hidden">
                  <img src={src} alt="" className="w-full h-full object-cover" />
                  <button type="button" onClick={() => removeFile(idx)} className="absolute top-0 right-0 bg-black/60 text-white rounded-full w-5 h-5 flex items-center justify-center"><X size={12} /></button>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700">
              <ImagePlus size={16} /> Добавить фото
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleFileChange} className="hidden" />
          </div>

          <Button type="submit" loading={saving} className="w-full">Сохранить изменения</Button>
        </form>
      </Card>
    </div>
  );
}