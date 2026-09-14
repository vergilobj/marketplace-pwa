import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import ConsultChat from './ConsultChat';

/**
 * Плавающая кнопка ИИ-консультанта — «вездесущность» (ЭТАП 4 ТЗ §5.4).
 *
 * ⚠️ Раскладка по вертикали (замерено по коду, а не на глаз):
 *   • нижнее таб-меню (Layout.tsx): bottom = --safe-bottom + 32px, высота ≈ 60px
 *     → верх меню ≈ --safe-bottom + 92px;
 *   • колокольчик OneSignal (public/onesignal-init.js): offset bottom 80px,
 *     right 15px, ширина ≈ 48px → занимает x ∈ [15, 63] от правого края;
 *   • нижняя панель действий на карточке товара (ProductDetailPage.tsx,
 *     мобильный вид): bottom 76px, высота ≈ 110px → до ~186px от низа.
 *
 * Поэтому кнопка стоит НАД меню (bottom = --safe-bottom + 96px) и ЛЕВЕЕ
 * колокольчика (right = --safe-right + 80px = 18 + 48 + 14): по вертикали
 * диапазоны пересекаются, но по горизонтали между ними 17px зазора — клик по
 * колокольчику не перехватывается.
 *
 * На мобильной карточке товара кнопка скрыта: там своя кнопка «Спросить у ИИ»
 * и нижняя панель действий, поверх которой плавающая кнопка села бы на «Купить».
 */
export default function FloatingConsultButton() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  const isDesktop = useMediaQuery('(min-width: 1024px)');

  // Страница /consult уже показывает чат целиком — дублировать кнопку незачем.
  const onConsultPage = location.pathname.startsWith('/consult');
  // Мобильная карточка товара: своя кнопка + нижняя панель действий.
  const onProductPage = /^\/products\/[^/]+$/.test(location.pathname);
  const blockedByProductBar = onProductPage && !isDesktop;

  const hidden =
    !isAuthenticated || onConsultPage || blockedByProductBar;

  // Смена роута закрывает виджет: контекст (товар) уже другой.
  useEffect(() => {
    setOpen(false);
  }, [location.pathname, location.search]);

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
          bottom: 'calc(var(--safe-bottom) + 96px)',
          // Правее этого значения сидит колокольчик OneSignal (right 15px, ~48px).
          right: 'calc(var(--safe-right) + 80px)',
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