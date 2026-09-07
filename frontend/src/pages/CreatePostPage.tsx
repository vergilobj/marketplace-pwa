import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText, ImagePlus, X } from 'lucide-react';
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
    <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-6 pb-20">
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-[var(--color-muted)] hover:text-[var(--color-text)] mb-6 transition-colors text-sm">
        <ArrowLeft size={16} /> Назад
      </button>

      <div className="flex items-center gap-3 mb-6">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#22c55e] to-[#34d399] flex items-center justify-center text-[#0d1512]">
          <FileText size={20} />
        </div>
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Новый пост</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-[var(--color-muted)] mb-1.5">Заголовок</label>
          <input
            value={form.title}
            onChange={e => setForm({ ...form, title: e.target.value })}
            placeholder="О чём пост?"
            className="w-full px-4 py-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] text-sm placeholder:text-[var(--color-faint)] outline-none focus:border-[#22c55e]/50 transition-colors"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--color-muted)] mb-1.5">Текст</label>
          <textarea
            value={form.content}
            onChange={e => setForm({ ...form, content: e.target.value })}
            rows={5}
            placeholder="Расскажи своим..."
            className="w-full px-4 py-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] text-sm placeholder:text-[var(--color-faint)] outline-none focus:border-[#22c55e]/50 transition-colors resize-none"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--color-muted)] mb-1.5">Ссылка (необязательно)</label>
          <input
            value={form.link}
            onChange={e => setForm({ ...form, link: e.target.value })}
            placeholder="https://..."
            className="w-full px-4 py-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] text-sm placeholder:text-[var(--color-faint)] outline-none focus:border-[#22c55e]/50 transition-colors"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--color-muted)] mb-1.5">Видео (YouTube/Vimeo)</label>
          <input
            value={form.videoUrl}
            onChange={e => setForm({ ...form, videoUrl: e.target.value })}
            placeholder="https://youtube.com/..."
            className="w-full px-4 py-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] text-sm placeholder:text-[var(--color-faint)] outline-none focus:border-[#22c55e]/50 transition-colors"
          />
        </div>

        {/* Фото */}
        <div>
          <label className="block text-sm font-medium text-[var(--color-muted)] mb-1.5">Изображения</label>
          <div className="flex flex-wrap gap-2 mb-3">
            {previews.map((src, idx) => (
              <div key={idx} className="relative w-20 h-20 rounded-xl overflow-hidden border border-[var(--color-border)]">
                <img src={src} alt={`preview ${idx}`} className="w-full h-full object-cover" />
                <button type="button" onClick={() => removeFile(idx)} className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-5 h-5 flex items-center justify-center hover:bg-black/80">
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => fileInputRef.current?.click()} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-[var(--color-border)] text-[#22c55e] text-sm font-medium hover:border-[#22c55e]/50 transition-colors">
            <ImagePlus size={16} /> Добавить фото
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleFileChange} className="hidden" />
        </div>

        {error && <p className="text-sm text-red-400 bg-red-400/5 rounded-xl px-4 py-2.5">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-[#22c55e] text-[#0d1512] font-bold text-base hover:bg-[#16a34a] transition-colors disabled:opacity-50 shadow-[0_8px_32px_-8px_rgba(34,197,94,0.5)]"
        >
          {loading ? 'Публикуем...' : 'Опубликовать'}
        </button>
      </form>
    </div>
  );
}