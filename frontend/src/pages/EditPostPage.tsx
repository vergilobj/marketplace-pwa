import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText, ImagePlus, X } from 'lucide-react';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import api from '../api/axios';
import { uploadImage } from '../api/upload';
import { errorMessage } from '../utils/error';
import toast from 'react-hot-toast';

/**
 * B1: лимиты те же, что на бэкенде — пост title ≤200, content ≤5000
 * (create-post.dto.ts), фото ≤20 МБ (upload.controller.ts).
 */
const TITLE_MAX = 200;
const CONTENT_MAX = 5000;
const LINK_MAX = 500;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/** Счётчик длины в стиле FeedbackPage: у самого лимита — янтарный. */
function lengthCounterClass(length: number, max: number): string {
  return `text-[11px] ${length > max - 100 ? 'text-amber-400' : 'text-[var(--color-faint)]'}`;
}

export default function EditPostPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [form, setForm] = useState({ title: '', content: '', link: '' });
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
        // B1: поля «Видео URL» больше нет — при создании поста видео приходит
        // только загрузкой файла (CreatePostPage). Существующее видео не
        // трогаем: PATCH уходит без videoUrl, сервер его сохраняет.
        setForm({
          title: post.title,
          content: post.content || '',
          link: post.link || '',
        });
        setExistingMedia(post.media || []);
      }).finally(() => setLoading(false));
    }
  }, [id]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    // B1: отказ ДО загрузки — файл сверх лимита сервера (20 МБ) не уходит в сеть.
    const oversized = selected.filter(file => file.size > MAX_IMAGE_BYTES);
    if (oversized.length > 0) {
      toast.error(
        oversized.length === 1
          ? `Фото «${oversized[0].name}» больше 20 МБ`
          : `Фото больше 20 МБ не добавлены: ${oversized.length}`,
      );
    }
    const allowed = selected.filter(file => file.size <= MAX_IMAGE_BYTES);
    setFiles(prev => [...prev, ...allowed]);
    allowed.forEach(file => {
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
    // B1: сервер режет title ≤200 / content ≤5000 — не гоняем запрос зря.
    if (form.title.length > TITLE_MAX || form.content.length > CONTENT_MAX) {
      toast.error(
        form.title.length > TITLE_MAX
          ? `Слишком длинно: максимум ${TITLE_MAX} символов`
          : `Слишком длинно: максимум ${CONTENT_MAX} символов`,
      );
      return;
    }
    setSaving(true);
    try {
      // Загружаем новые фото
      const uploadedUrls: string[] = [];
      for (const file of files) {
        const url = await uploadImage(file);
        uploadedUrls.push(url);
      }
      const allMedia = [...existingMedia, ...uploadedUrls];

      // videoUrl не отправляем: поля в форме нет (видео — только загрузкой
      // файла при создании). PATCH без ключа сохраняет текущее значение.
      await api.patch(`/posts/${id}`, {
        title: form.title,
        content: form.content,
        link: form.link || undefined,
        media: allMedia.length > 0 ? allMedia : undefined,
      });
      toast.success('Пост обновлён');
      navigate(`/posts/${id}`);
    } catch (err: unknown) {
      // B1: раньше здесь стояло глухое «Ошибка при сохранении» — причина
      // (лимит длины, 403, сеть) не доходила до пользователя.
      toast.error(errorMessage(err, 'Ошибка при сохранении'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-center py-10 text-[var(--color-muted)]">Загрузка...</p>;

  return (
    <div className="max-w-xl mx-auto">
      <button
        onClick={() => navigate(`/posts/${id}`)}
        className="flex items-center text-sm text-[var(--color-muted)] hover:text-[#22c55e] transition-colors mb-6"
      >
        <ArrowLeft size={16} className="mr-1" /> Назад
      </button>
      <Card>
        <div className="flex items-center gap-3 mb-6">
          <FileText className="w-6 h-6 text-[#22c55e]" />
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Редактировать пост</h1>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Input label="Заголовок" value={form.title} maxLength={TITLE_MAX} onChange={e => setForm({ ...form, title: e.target.value })} required />
            <div className="flex justify-end mt-1">
              <span className={lengthCounterClass(form.title.length, TITLE_MAX)}>
                {form.title.length}/{TITLE_MAX}
              </span>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--color-muted)] mb-1">Текст</label>
            <textarea
              value={form.content}
              maxLength={CONTENT_MAX}
              onChange={e => setForm({ ...form, content: e.target.value })}
              rows={4}
              className="w-full px-4 py-3 rounded-xl bg-[rgba(255,255,255,0.04)] border border-[var(--color-border)] text-[var(--color-text)] placeholder-[var(--color-faint)] focus:border-[rgba(34,197,94,0.6)] focus:shadow-[0_0_0_3px_rgba(34,197,94,0.15)] outline-none transition-all duration-200"
            />
            <div className="flex justify-end mt-1">
              <span className={lengthCounterClass(form.content.length, CONTENT_MAX)}>
                {form.content.length}/{CONTENT_MAX}
              </span>
            </div>
          </div>
          <Input label="Ссылка (необязательно)" value={form.link} maxLength={LINK_MAX} onChange={e => setForm({ ...form, link: e.target.value })} />

          {/* B1: поля «Видео URL» здесь больше нет — при создании поста видео
              приходит только загрузкой файла (CreatePostPage). */}

          {/* Существующие медиа */}
          {existingMedia.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-[var(--color-muted)] mb-1">Текущие изображения</label>
              <div className="flex flex-wrap gap-2">
                {existingMedia.map((url, idx) => (
                  <div key={idx} className="relative w-20 h-20 rounded-lg overflow-hidden border border-[var(--color-border)]">
                    <img src={url} alt="" width={80} height={80} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                    <button type="button" onClick={() => removeExistingMedia(idx)} className="absolute top-0 right-0 bg-black/60 text-[var(--color-text)] rounded-full w-5 h-5 flex items-center justify-center"><X size={12} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Новые фото */}
          <div>
            <label className="block text-sm font-medium text-[var(--color-muted)] mb-1">Добавить фото</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {previews.map((src, idx) => (
                <div key={idx} className="relative w-20 h-20 rounded-lg overflow-hidden border border-[var(--color-border)]">
                  <img src={src} alt="" width={80} height={80} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                  <button type="button" onClick={() => removeFile(idx)} className="absolute top-0 right-0 bg-black/60 text-[var(--color-text)] rounded-full w-5 h-5 flex items-center justify-center"><X size={12} /></button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1 text-sm text-[#22c55e] hover:text-[#16a34a] transition-colors"
            >
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