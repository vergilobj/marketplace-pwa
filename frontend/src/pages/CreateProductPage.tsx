import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, PackagePlus, ImagePlus, Video, X } from 'lucide-react';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import { createProduct } from '../api/products';
import { uploadImage, uploadVideo } from '../api/upload';
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
  const [videoPreview, setVideoPreview] = useState('');
  const [videoUploading, setVideoUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

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

      await createProduct({
        title: form.title,
        description: form.description,
        price: parseFloat(form.price),
        media: uploadedUrls,
        // Видео — только загрузкой файла. Ссылок на внешние хостинги нет.
        videoUrl: videoUrl || undefined,
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

          {/* ЕДИНЫЙ БЛОК МЕДИА: видео первым, фото после. Поля ссылки на видео нет. */}
          <div className="rounded-2xl border border-[var(--color-border)] p-4">
            <label className="block text-sm font-medium text-[var(--color-muted)] mb-1">Медиа</label>
            <p className="text-[11px] text-[var(--color-faint)] mb-3">Видео встанет первым в галерею товара, фотографии — после него.</p>

            <div className="flex flex-wrap gap-2 mb-3">
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
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileChange}
              className="hidden"
            />
            <p className="text-[11px] text-[var(--color-faint)]">Видео: mp4, webm, mov, mkv, до 100 МБ. Фото: до 20 МБ каждое.</p>
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}
          <Button type="submit" loading={loading} className="w-full">Создать товар</Button>
        </form>
      </Card>
    </div>
  );
}