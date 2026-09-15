import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import ConsultChat from './ConsultChat';

/**
 * Плавающая кнопка ИИ-консультанта — «вездесущность» (ЭТАП 4 ТЗ §5.4).
 *
 * ⚠️ ФАКТИЧЕСКАЯ РАСКЛАДКА (перепроверено замером 2026-09-15).
 * Кнопка живёт в правом нижнем углу: `right = var(--safe-right) + 18px`,
 * `bottom = var(--safe-bottom) + 136px`, размер 56×56.
 *   • по вертикали: колокольчик OneSignal (public/onesignal-init.js, offset
 *     bottom 80px, высота 32px → y ∈ [80, 112] от низа) и FAB
 *     (y ∈ [136, 192]) НЕ пересекаются — между ними 24px зазора;
 *   • по горизонтали: кнопка стоит на 18px от края — то есть в той же
 *     полосе, что и колокольчик (он занимает x ∈ [15, 63] от правого края),
 *     и по x диапазоны ПЕРЕСЕКАЮТСЯ.
 * Пересечение по одной оси клик не перехватывает: тапабельные области
 * разнесены по вертикали, зазор 24px, и клик по колокольчику доходит до
 * него. Позиция проверена замером и менять её не нужно.
 *
 * ⚠️ История: предыдущая версия этого комментария описывала СТАРУЮ
 * раскладку (`right: safe + 80`, «кнопка ЛЕВЕЕ колокольчика, 17px зазора»)
 * и не соответствовала коду — из-за неё в аудите появилась ложная находка
 * «FAB перекрывает колокольчик». Если правишь позицию — правь и текст.
 *
 * Нижнее таб-меню (Layout.tsx): bottom = --safe-bottom + 32px, высота ≈ 60px
 * → верх меню ≈ --safe-bottom + 92px; кнопка начинается с 136px, то есть
 * выше меню с запасом 44px.
 *
 * На мобильной карточке товара кнопка скрыта: там своя кнопка «Спросить у ИИ»
 * и нижняя панель действий, поверх которой плавающая кнопка села бы на «Купить».
 */
export default function FloatingConsultButton() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  const isDesktop = useMediaQuery('(min-width: 1024px)');

  // Страница /consult уже показывает чат целиком — дублировать кнопку незачем.
  const onConsultPage = location.pathname.startsWith('/consult');
  // Мобильная карточка товара: своя кнопка + нижняя панель действий.
  const onProductPage = /^\/products\/[^/]+$/.test(location.pathname);
  const blockedByProductBar = onProductPage && !isDesktop;

  const hidden =
    !isAuthenticated || onConsultPage || blockedByProductBar;

  /**
   * Смена роута закрывает виджет: контекст (товар) уже другой.
   *
   * Было `useEffect(() => setOpen(false), [location.pathname, location.search])`
   * — синхронный setState в эффекте (линт `react-hooks/set-state-in-effect`,
   * ошибка жила в файле с прошлых правок). Заменили на ПРОИЗВОДНОЕ состояние:
   * открытость привязана к ключу роута, и при смене роута ключ перестаёт
   * совпадать → виджет считается закрытым сам, без эффекта и без лишнего
   * каскадного рендера. Заодно исчез кадр, в котором виджет с прежним
   * контекстом ещё виден на новом роуте.
   */
  const routeKey = `${location.pathname}${location.search}`;
  const [openState, setOpenState] = useState<{ route: string; open: boolean }>({
    route: routeKey,
    open: false,
  });
  const open = openState.route === routeKey && openState.open;
  const setOpen = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      setOpenState((prev) => {
        const current = prev.route === routeKey ? prev.open : false;
        return { route: routeKey, open: typeof next === 'function' ? next(current) : next };
      });
    },
    [routeKey],
  );

  /**
   * SCROLL-LOCK (2026-09-15): пока открыт виджет, фон не прокручивается —
   * то же поведение, что у Modal (`document.body.style.overflow`). Прежнее
   * значение запоминаем: при закрытии возвращаем ровно его, иначе снесли бы
   * блокировку, поставленную другой модалкой.
   */
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  /**
   * ESCAPE ЗАКРЫВАЕТ ВИДЖЕТ (2026-09-15). Раньше Escape работал только у
   * Modal, у FAB обработчика не было. Слушаем на capture-фазе: если поверх
   * открыта модалка (Modal), она погасит событие через stopPropagation и
   * виджет не закроется вместе с ней. Снимается вместе с эффектом — при
   * закрытии виджета слушателя в документе не остаётся.
   */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, setOpen]);

  if (hidden) return null;

  return (
    <>
      {/* Кнопка */}
      <motion.button
        type="button"
        onClick={() => setOpen((v) => !v)}
        whileTap={{ scale: 0.92 }}
        aria-label={open ? 'Закрыть консультанта' : 'Открыть ИИ-консультанта'}
        aria-expanded={open}
        title="ИИ-консультант"
        data-consult-fab="true"
        className="fixed z-[55] w-14 h-14 rounded-full flex items-center justify-center shadow-[0_10px_30px_-6px_rgba(34,197,94,0.6)]"
        style={{
          // 56px (круг) — тач-таргет заметно больше требуемых 44px.
          background: '#22c55e',
          color: '#0b0e0d',
          // FIX (2026-09-14): было bottom 96 / right 80 — кнопка прижималась
          // к нижнему меню (зазор 2px) и висела далеко от правого края.
          // Ставим 18px от края (как у меню) и ПОДНИМАЕМ над колокольчиком
          // OneSignal: он занимает bottom 80..112 (32px), поэтому FAB с
          // bottom 136 сидит выше него с зазором 16px и не перекрывает.
          bottom: 'calc(var(--safe-bottom) + 136px)',
          right: 'calc(var(--safe-right) + 18px)',
        }}
      >
        <AnimatePresence mode="wait" initial={false}>
          {open ? (
            <motion.span
              key="close"
              initial={{ opacity: 0, rotate: -90 }}
              animate={{ opacity: 1, rotate: 0 }}
              exit={{ opacity: 0, rotate: 90 }}
              transition={{ duration: 0.15 }}
              className="text-2xl leading-none font-bold"
            >
              ×
            </motion.span>
          ) : (
            <motion.span
              key="spark"
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.7 }}
              transition={{ duration: 0.15 }}
              className="flex items-center justify-center"
            >
              <Sparkles size={22} />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      {/* Виджет */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              key="consult-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-[56] bg-black/50"
            />
            <motion.div
              key="consult-sheet"
              role="dialog"
              aria-label="ИИ-консультант"
              initial={{ y: '100%', opacity: 0.6 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0.6 }}
              transition={{ type: 'spring', damping: 30, stiffness: 320 }}
              // Отступ от краёв = ширина кнопки: виджет не накрывает её, и
              // крестик на кнопке остаётся доступным для закрытия.
              className="fixed z-[57] left-4 right-4 bottom-4 sm:left-auto sm:right-[92px] sm:bottom-[168px] sm:w-[400px] rounded-3xl border border-[rgba(255,255,255,0.08)] bg-[#111918] shadow-[0_-16px_48px_-12px_rgba(0,0,0,0.7)] flex flex-col overflow-hidden"
              style={{
                maxHeight: '70dvh',
                paddingBottom: 'var(--safe-bottom)',
              }}
            >
              <div className="px-4 pt-4 pb-3 flex-1 min-h-0 flex flex-col">
                <ConsultChat compact onClose={() => setOpen(false)} />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}