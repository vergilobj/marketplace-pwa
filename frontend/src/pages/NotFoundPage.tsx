import { useNavigate } from 'react-router-dom';
import { Compass, Home, LayoutGrid } from 'lucide-react';

export default function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 60% 40% at 50% -5%, rgba(34,197,94,0.10) 0%, transparent 60%)',
        }}
      />

      <div className="relative max-w-5xl mx-auto px-4 sm:px-6 pt-24 pb-24 text-center">
        <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] flex items-center justify-center">
          <Compass size={28} className="text-[#22c55e]" />
        </div>

        <div className="text-[11px] uppercase tracking-[0.3em] text-[var(--color-muted)] mb-3">
          ошибка 404
        </div>

        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[var(--color-text)] leading-tight">
          Страница не найдена
        </h1>

        <p className="mt-4 text-sm text-[var(--color-muted)] max-w-md mx-auto">
          Такой страницы здесь нет. Возможно, ссылку убрали или она никогда не существовала.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-2.5">
          <button
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-2 px-5 h-11 rounded-full bg-[#22c55e] text-[#0b0e0d] text-sm font-bold hover:bg-[#16a34a] transition-colors"
          >
            <Home size={16} strokeWidth={2.5} /> На главную
          </button>
          <button
            onClick={() => navigate('/products')}
            className="inline-flex items-center gap-2 px-5 h-11 rounded-full border border-[var(--color-border)] text-[var(--color-text)] text-sm font-bold hover:border-[#22c55e]/40 hover:bg-[var(--color-surface)] transition-colors"
          >
            <LayoutGrid size={16} strokeWidth={2.5} /> В каталог
          </button>
        </div>
      </div>
    </div>
  );
}