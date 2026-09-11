import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, PackagePlus, FileText } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

type Variant = 'icon' | 'nav' | 'button';

interface CreateMenuProps {
  variant?: Variant;
  className?: string;
  label?: string;
}

export function CreateMenu({ variant = 'icon', className = '', label = 'Создать' }: CreateMenuProps) {
  const { isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const canCreateProduct = user?.role === 'SELLER' || user?.role === 'ADMIN';

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!isAuthenticated) return null;

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  // Кнопка-триггер
  let trigger: React.ReactNode;
  if (variant === 'nav') {
    trigger = (
      <button
        type="button"
        title="Создать"
        onClick={() => setOpen(true)}
        data-create-menu="nav"
        className={`flex flex-col items-center justify-center shrink-0 min-h-[44px] text-[#0b0e0d] ${className}`}
      >
        <span className="w-11 h-11 -mt-4 rounded-full bg-[#22c55e] text-[#0b0e0d] flex items-center justify-center shadow-[0_6px_20px_-4px_rgba(34,197,94,0.6)] border-4 border-[rgba(17,25,24,0.88)]">
          <Plus size={22} strokeWidth={2.5} />
        </span>
      </button>
    );
  } else if (variant === 'button') {
    trigger = (
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-create-menu="button"
        className={`inline-flex items-center justify-center gap-2 px-4 min-h-[44px] rounded-full bg-[#22c55e] text-[#0d1512] text-sm font-bold hover:bg-[#16a34a] transition-colors ${className}`}
      >
        <Plus size={16} strokeWidth={2.5} /> {label}
      </button>
    );
  } else {
    trigger = (
      <button
        type="button"
        title="Создать"
        onClick={() => setOpen(true)}
        data-create-menu="icon"
        className={`w-11 h-11 rounded-full bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.08)] text-[var(--color-muted)] hover:text-[#22c55e] transition-colors flex items-center justify-center ${className}`}
      >
        <Plus size={18} strokeWidth={2.5} />
      </button>
    );
  }

  const overlay = (
    <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm"
            />

            {/* Мобиле — bottom-sheet */}
            <motion.div
              key="sheet"
              initial={{ y: '100%', opacity: 0.6 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0.6 }}
              transition={{ type: 'spring', damping: 30, stiffness: 320 }}
              className="md:hidden fixed left-0 right-0 bottom-0 z-[61] rounded-t-3xl bg-[#111918] border-t border-[rgba(255,255,255,0.08)] p-4 pb-8 shadow-[0_-16px_48px_-12px_rgba(0,0,0,0.7)]"
            >
              <div className="w-10 h-1 rounded-full bg-[rgba(255,255,255,0.14)] mx-auto mb-4" />
              <div className="text-[11px] uppercase tracking-wider text-[var(--color-muted)] px-1 mb-2">
                Создать
              </div>
              <div className="space-y-1.5">
                {canCreateProduct && (
                  <MenuRow
                    icon={<PackagePlus size={20} />}
                    title="Товар"
                    subtitle="Выставить на продажу"
                    onClick={() => go('/products/new')}
                  />
                )}
                <MenuRow
                  icon={<FileText size={20} />}
                  title="Пост"
                  subtitle="Написать в ленту"
                  onClick={() => go('/posts/new')}
                />
              </div>
            </motion.div>

            {/* Десктоп — dropdown по центру */}
            <motion.div
              key="dropdown"
              initial={{ opacity: 0, y: -8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.97 }}
              transition={{ duration: 0.16 }}
              className="hidden md:block fixed left-1/2 -translate-x-1/2 top-24 z-[61] w-72 rounded-2xl bg-[#111918] border border-[rgba(255,255,255,0.08)] p-2 shadow-[0_16px_48px_-12px_rgba(0,0,0,0.7)]"
            >
              {canCreateProduct && (
                <MenuRow
                  icon={<PackagePlus size={20} />}
                  title="Товар"
                  subtitle="Выставить на продажу"
                  onClick={() => go('/products/new')}
                />
              )}
              <MenuRow
                icon={<FileText size={20} />}
                title="Пост"
                subtitle="Написать в ленту"
                onClick={() => go('/posts/new')}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>
  );

  return (
    <>
      {trigger}
      {/* Портал в body: предки с backdrop-blur/transform создают containing block
          и ломают позиционирование fixed-оверлея */}
      {createPortal(overlay, document.body)}
    </>
  );
}

function MenuRow({
  icon,
  title,
  subtitle,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-create-item={title === 'Товар' ? 'product' : 'post'}
      className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-left transition-colors hover:bg-[rgba(34,197,94,0.08)] group"
    >
      <span className="w-10 h-10 shrink-0 rounded-xl flex items-center justify-center bg-[rgba(34,197,94,0.1)] text-[#22c55e] group-hover:bg-[rgba(34,197,94,0.16)] transition-colors">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-bold text-[var(--color-text)]">{title}</span>
        <span className="block text-[12px] text-[var(--color-muted)]">{subtitle}</span>
      </span>
    </button>
  );
}

export default CreateMenu;