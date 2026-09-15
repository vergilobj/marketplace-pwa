import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalProps { isOpen: boolean; onClose: () => void; title?: string; children: React.ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'; showClose?: boolean; closeOnOverlay?: boolean; }

const sizes: Record<string, string> = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-xl', full: 'max-w-2xl' };

/**
 * Селектор фокусируемых элементов для focus-trap.
 * `[tabindex="-1"]` исключён намеренно: это контейнеры, которые нельзя
 * достичь клавиатурой, в ловушке они только мешают.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
  'textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Модальное окно.
 *
 * ВЫСОТА И СКРОЛЛ (2026-09-15): на 390px содержимое вылезало за экран и
 * внутреннего скролла не было — до кнопок внизу не добраться. Теперь:
 *   • окно ограничено `max-height: 90dvh` (inline — он же фолбэк-слой: в
 *     браузерах без `dvh` объявление отбрасывается и работает класс 90vh);
 *   • заголовок и крестик — `shrink-0`, не уезжают при скролле;
 *   • содержимое — отдельный `overflow-y-auto` контейнер (`min-h-0`,
 *     без него flex-элемент не сжимается и скролл не появляется).
 *
 * ЛОВУШКА ПРОЕКТА (backdrop-blur): `backdrop-filter` создаёт containing block
 * для `position: fixed` потомков — fixed-элемент внутри блюр-контейнера
 * позиционируется от него, а не от вьюпорта. Здесь это обойдено тем, что
 * оверлей рендерится порталом в `document.body`: ни сам оверлей, ни его
 * потомки не зависят от transform/backdrop-filter предков страницы.
 *
 * ФОКУС (2026-09-15): раньше фокус оставался на странице ПОД модалкой
 * (ввод уходил в поиск за ней), Tab уводил из окна. Теперь: автофокус на
 * первое поле при открытии, Tab/Shift+Tab зациклены внутри, при закрытии
 * фокус возвращается инициатору.
 */
export default function Modal({ isOpen, onClose, title, children, size = 'md', showClose = true, closeOnOverlay = true }: ModalProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  /** Элемент, на котором был фокус до открытия — вернуть при закрытии. */
  const restoreRef = useRef<HTMLElement | null>(null);

  // Scroll-lock фона + возврат фокуса инициатору.
  useEffect(() => {
    if (!isOpen) return;
    restoreRef.current = (document.activeElement as HTMLElement | null) ?? null;
    // Запоминаем прежнее значение: несколько модалок подряд не должны
    // снимать блокировку, поставленную другой (или внешним кодом).
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      const el = restoreRef.current;
      if (el && document.contains(el)) el.focus();
    };
  }, [isOpen]);

  // Escape — закрыть.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Гасим событие, чтобы Escape не дошёл до фоновых обработчиков
      // (например, до закрытия поиска в шапке).
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [isOpen, onClose]);

  // Автофокус на первое поле + удержание Tab внутри окна.
  useEffect(() => {
    if (!isOpen) return;
    const node = contentRef.current;
    if (!node) return;

    const list = () =>
      Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetWidth > 0 || el.offsetHeight > 0,
      );

    // Приоритет — поле ввода: модалки в проекте (форма базы знаний и т.п.)
    // открываются ради ввода. Если полей нет — первый фокусируемый элемент,
    // если и его нет — сам контейнер (tabIndex=-1, чтобы Tab не ушёл наружу).
    const field = node.querySelector<HTMLElement>('input:not([type="hidden"]), textarea, select');
    (field ?? list()[0] ?? node).focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = list();
      if (items.length === 0) {
        e.preventDefault();
        node.focus();
        return;
      }
      const idx = items.indexOf(document.activeElement as HTMLElement);
      if (idx === -1) {
        e.preventDefault();
        (e.shiftKey ? items[items.length - 1] : items[0]).focus();
        return;
      }
      if (!e.shiftKey && idx === items.length - 1) {
        e.preventDefault();
        items[0].focus();
      } else if (e.shiftKey && idx === 0) {
        e.preventDefault();
        items[items.length - 1].focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  if (!isOpen) return null;

  const overlay = (
    <div className="modal-overlay fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={closeOnOverlay ? onClose : undefined}>
      <div
        ref={contentRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`modal-content ${sizes[size]} w-full max-h-[90vh] flex flex-col glass-strong rounded-3xl shadow-2xl shadow-black/10 overflow-hidden outline-none`}
        style={{ maxHeight: '90dvh' }}
        onClick={e => e.stopPropagation()}
      >
        {(title || showClose) && <div className="shrink-0 flex items-center justify-between px-6 pt-6 pb-2">{title && <h2 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h2>}{showClose && <button onClick={onClose} aria-label="Закрыть" title="Закрыть" className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-white/10 text-slate-400 hover:text-slate-600 ml-auto"><X size={18} /></button>}</div>}
        <div className="p-6 pt-2 flex-1 min-h-0 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}