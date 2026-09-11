import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, PackagePlus, ImagePlus, Video, X, Link2 } from 'lucide-react';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import { createProduct } from '../api/products';
import { uploadImage, uploadVideo } from '../api/upload';
import { getVideoEmbed } from '../utils/video';
import { formatPrice } from '../utils/format';
import DictateButton from '../components/DictateButton';
import { errorMessage } from '../utils/error';

export default function CreateProductPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ title: '', description: '', price: '' });
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [externalVideoUrl, setExternalVideoUrl] = useState('');
  const [videoPreview, setVideoPreview] = useState('');
  const [videoUploading, setVideoUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const externalEmbed = getVideoEmbed(externalVideoUrl);
  const priceNumber = parseFloat(form.price);
  const pricePreview = Number.isFinite(priceNumber) ? formatPrice(priceNumber) : '';

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

      // Приоритет: внешняя ссылка важнее загруженного файла.
      const finalVideoUrl = externalVideoUrl.trim() || videoUrl || undefined;

      await createProduct({
        title: form.title,
        description: form.description,
        price: parseFloat(form.price),
        media: uploadedUrls,
        videoUrl: finalVideoUrl,
      });

      navigate('/products');
    } catch (err: unknown) {
      setError(errorMessage(err, 'Ошибка при создании товара'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto">
      <button
        onClick={() => navigate(-1)}
        className="tap-link text-sm text-[var(--color-muted)] hover:text-[#22c55e] transition-colors mb-6"
      >
        <ArrowLeft size={16} className="mr-1" /> Назад
      </button>
      <Card>
        <div className="flex items-center gap-3 mb-6">
          <PackagePlus className="w-6 h-6 text-[#22c55e]" />
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Новый товар</h1>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input label="Название" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required />
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input label="Описание" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            </div>
            <DictateButton size={18} className="w-11 h-11" onResult={(text) => setForm(f => ({ ...f, description: text }))} />
          </div>
          <div>
            <Input label="Цена (USDT)" type="number" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} required />
            {pricePreview && (
              <p className="mt-1.5 text-[11px] text-[var(--color-muted)]">
                Покажем как <span className="text-[#22c55e] font-semibold">{pricePreview}</span>
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--color-muted)] mb-1">Фотографии</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {previews.map((src, idx) => (
                <div key={idx} className="relative w-20 h-20 rounded-lg overflow-hidden border border-[var(--color-border)]">
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
              className="tap-link gap-1 text-sm text-[#22c55e] hover:text-[#16a34a] transition-colors"
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

          <div>
            <label className="block text-sm font-medium text-[var(--color-muted)] mb-1">Видео</label>

            {/* Способ 1 — внешняя ссылка (приоритетнее файла) */}
            <div className="mb-3">
              <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">Ссылка на видео</label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Link2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-faint)]" />
                  <input
                    type="url"
                    value={externalVideoUrl}
                    onChange={e => setExternalVideoUrl(e.target.value)}
                    placeholder="YouTube, RuTube, VK Video, Яндекс.Диск, Google Диск, Telegram…"
                    className="w-full pl-9 pr-9 py-2.5 rounded-xl bg-[var(--color-surface)] text-[var(--color-text)] text-sm outline-none border border-[var(--color-border)] focus:border-[#22c55e] transition-colors"
                  />
                  {externalVideoUrl && (
                    <button
                      type="button"
                      onClick={() => setExternalVideoUrl('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-faint)] hover:text-[var(--color-text)] transition-colors"
                      title="Очистить ссылку"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
              </div>

              {externalVideoUrl && (
                <div className="mt-2">
                  {externalEmbed?.type === 'iframe' ? (
                    <div className="rounded-xl overflow-hidden border border-[var(--color-border)] aspect-video">
                      <iframe src={externalEmbed.src} className="w-full h-full" allowFullScreen title="Превью видео" />
                    </div>
                  ) : externalEmbed?.type === 'video' ? (
                    <video src={externalEmbed.src} controls playsInline className="w-full max-h-56 rounded-xl bg-black" />
                  ) : (
                    <a
                      href={externalEmbed?.src || externalVideoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-[#22c55e] hover:text-[#34d399] break-all transition-colors"
                    >
                      <Video size={15} /> {externalEmbed?.label || 'Открыть видео'}
                    </a>
                  )}
                </div>
              )}
            </div>

            {/* Способ 2 — загрузка файла (перекрывается ссылкой) */}
            <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">…или загрузить файл</label>
            {videoFile || videoUrl ? (
              <div className="relative rounded-lg overflow-hidden mb-2 border border-[var(--color-border)]">
                {videoPreview ? (
                  <video src={videoPreview} controls playsInline className="w-full max-h-56 bg-black" />
                ) : (
                  <div className="w-full h-32 flex items-center justify-center bg-[var(--bg-3)] text-sm text-[var(--color-muted)]">
                    {videoUploading ? 'Загружаем...' : 'Видео загружено'}
                  </div>
                )}
                <button
                  type="button"
                  onClick={removeVideo}
                  className="absolute top-2 right-2 bg-black/60 text-[var(--color-text)] rounded-full w-6 h-6 flex items-center justify-center"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => videoInputRef.current?.click()}
                disabled={videoUploading}
                className="tap-link gap-1 text-sm text-[#22c55e] hover:text-[#16a34a] disabled:opacity-50 transition-colors"
              >
                <Video size={16} /> {videoUploading ? 'Загружаем видео...' : 'Загрузить видео'}
              </button>
            )}
            <input
              ref={videoInputRef}
              type="file"
              accept="video/mp4,video/webm,video/quicktime,video/x-matroska"
              onChange={handleVideoChange}
              className="hidden"
            />
            <p className="text-[11px] text-[var(--color-faint)] mt-1">mp4, webm, mov или mkv, до 100 МБ</p>
            {externalVideoUrl.trim() && (videoFile || videoUrl) && (
              <p className="text-[11px] text-[#22c55e] mt-1">Ссылка на видео приоритетнее загруженного файла — будет использована она.</p>
            )}
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}
          <Button type="submit" loading={loading} className="w-full">Создать товар</Button>
        </form>
      </Card>
    </div>
  );
}