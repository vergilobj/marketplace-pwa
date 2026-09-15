import React from 'react';
import { motion } from 'framer-motion';

/**
 * Переход между страницами.
 *
 * ЧТО БЫЛО НЕ ТАК (проверено 2026-09-15).
 * Компонент задавал `exit={{ opacity: 0, y: -20 }}`, но нигде в приложении он
 * не обёрнут в `AnimatePresence`: `Layout` рендерит
 * `<PageTransition><Outlet /></PageTransition>`, а `AnimatePresence` в
 * `Layout`/`App` нет вообще. Без `AnimatePresence` `exit` — мёртвый проп, он
 * не проигрывается никогда: анимации выхода не существовало, хотя код её
 * обещал.
 *
 * ПОЧЕМУ НЕ ДОБАВИЛИ `AnimatePresence` (а убрали `exit`).
 * Чтобы `exit` заработал, `AnimatePresence` должен стоять ВЫШЕ `Outlet` с
 * ключом по `location.pathname`. Тогда он на время анимации держит в дереве
 * СТАРУЮ страницу целиком — с её эффектами, запросами и socket-подписками —
 * и только потом монтирует новую. Для маркетплейса это лишние запросы,
 * задержка перехода и риск утечек; плюс это правка `Layout.tsx` (файл другого
 * билдера в этой волне), а выигрыш — только косметическая анимация выхода.
 * Поэтому корректное решение здесь — убрать мёртвый `exit` и оставить
 * работающую анимацию входа. Разметка и поведение не меняются: страница
 * по-прежнему появляется с fade+сдвигом на 20px.
 *
 * Если анимацию выхода всё-таки захотят вернуть — это отдельная задача:
 * `AnimatePresence mode="wait"` + `key={location.pathname}` в `Layout.tsx`.
 */
export default function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeInOut' }}
    >
      {children}
    </motion.div>
  );
}