import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText, ImagePlus, Video, X } from 'lucide-react';
import { createPost } from '../api/posts';
import { uploadImage, uploadVideo } from '../api/upload';
import { errorMessage } from '../utils/error';

export default function CreatePostPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ title: '', content: '', link: '' });
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [videoPreview, setVideoPreview] = useState('');
  const [videoUploading, setVideoUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

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

  const handleVideoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setVideoFile(file);
    setVideoPreview(URL.createObjectURL(file));
    setVideoUploading(true);
    setError('');
    try {
      const url = await uploadVideo(file);
      setVideoUrl(url);
    } catch (err: unknown) {
      setError(errorMessage(err, 'Ошибка при загрузке видео'));
      setVideoFile(null);
      setVideoPreview('');
    } finally {
      setVideoUploading(false);
    }
    if (videoInputRef.current) videoInputRef.current.value = '';
  };

  const removeVideo = () => {
    setVideoFile(null);
    setVideoUrl('');
    setVideoPreview('');
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
        // Видео — только загрузкой файла (ссылок нет).
        videoUrl: videoUrl || undefined,
        media: uploadedUrls.length > 0 ? uploadedUrls : undefined,
      });
      navigate('/');
    } catch (err: unknown) {
      setError(errorMessage(err, 'Ошибка при создании поста'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-6 pb-20">
      <button onClick={() => navigate(-1)} className="tap-link items-center gap-2 text-[var(--color-muted)] hover:text-[var(--color-text)] mb-6 transition-colors text-sm">
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

        {/* ЕДИНЫЙ БЛОК МЕДИА: видео первым, фото после. Не отдельные блоки. */}
        <div className="rounded-2xl border border-[var(--color-border)] p-4">
          <label className="block text-sm font-medium text-[var(--color-muted)] mb-1">Медиа</label>
          <p className="text-[11px] text-[var(--color-faint)] mb-3">Видео встанет первым, фотографии — после него.</p>

          <div className="flex flex-wrap gap-2 mb-3">
            {/* Видео — первый элемент общего ряда */}
            {videoFile || videoUrl ? (
              <div className="relative w-24 h-24 rounded-xl overflow-hidden border border-[var(--color-border)] bg-black">
                {videoPreview ? (
                  <video src={videoPreview} muted playsInline className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[10px] text-[var(--color-muted)] text-center px-1">
                    {videoUploading ? 'Загружаем…' : 'Видео'}
                  </div>
                )}
                <span className="absolute bottom-0 left-0 right-0 text-[9px] font-bold uppercase text-center text-white bg-black/60 py-0.5">Видео · 1-е</span>
                <button
                  type="button"
                  onClick={removeVideo}
                  aria-label="Убрать видео"
                  className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-5 h-5 flex items-center justify-center hover:bg-black/80"
                >
                  <X size={12} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => videoInputRef.current?.click()}
                disabled={videoUploading}
                className="w-24 h-24 rounded-xl border border-dashed border-[var(--color-border)] text-[#22c55e] text-[11px] font-medium hover:border-[#22c55e]/50 transition-colors disabled:opacity-50 flex flex-col items-center justify-center gap-1"
              >
                <Video size={18} />
                {videoUploading ? 'Загружаем…' : 'Видео'}
              </button>
            )}

            {previews.map((src, idx) => (
              <div key={idx} className="relative w-24 h-24 rounded-xl overflow-hidden border border-[var(--color-border)]">
                <img src={src} alt={`preview ${idx}`} width={96} height={96} loading="eager" decoding="async" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => removeFile(idx)}
                  aria-label={`Убрать фото ${idx + 1}`}
                  className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-5 h-5 flex items-center justify-center hover:bg-black/80"
                >
                  <X size={12} />
                </button>
              </div>
            ))}

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-24 h-24 rounded-xl border border-dashed border-[var(--color-border)] text-[#22c55e] text-[11px] font-medium hover:border-[#22c55e]/50 transition-colors flex flex-col items-center justify-center gap-1"
            >
              <ImagePlus size={18} />
              Фото
            </button>
          </div>

          <input
            ref={videoInputRef}
            type="file"
            accept="video/mp4,video/webm,video/quicktime,video/x-matroska"
            onChange={handleVideoChange}
            className="hidden"
          />
          <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleFileChange} className="hidden" />
          <p className="text-[11px] text-[var(--color-faint)]">Видео: mp4, webm, mov, mkv, до 100 МБ. Фото: до 20 МБ каждое.</p>
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