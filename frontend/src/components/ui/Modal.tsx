import { useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalProps { isOpen: boolean; onClose: () => void; title?: string; children: React.ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'; showClose?: boolean; closeOnOverlay?: boolean; }

const sizes: Record<string, string> = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-xl', full: 'max-w-2xl' };

export default function Modal({ isOpen, onClose, title, children, size = 'md', showClose = true, closeOnOverlay = true }: ModalProps) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (isOpen) { document.addEventListener('keydown', h); document.body.style.overflow = 'hidden'; }
    return () => { document.removeEventListener('keydown', h); document.body.style.overflow = ''; };
  }, [isOpen, onClose]);
  if (!isOpen) return null;
  return (
    <div className="modal-overlay fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={closeOnOverlay ? onClose : undefined}>
      <div className={`modal-content ${sizes[size]} w-full glass-strong rounded-3xl shadow-2xl shadow-black/10 overflow-hidden`} onClick={e => e.stopPropagation()}>
        {(title || showClose) && <div className="flex items-center justify-between px-6 pt-6 pb-2">{title && <h2 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h2>}{showClose && <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-white/10 text-slate-400 hover:text-slate-600 ml-auto"><X size={18} /></button>}</div>}
        <div className="p-6 pt-2">{children}</div>
      </div>
    </div>
  );
}
