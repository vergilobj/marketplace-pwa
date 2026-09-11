import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ShoppingBasket } from 'lucide-react';
import type { BazarRef } from '../../api/bazar';
import { MINT, NEON_GREEN, REF_STYLE, formatPrice, refHref } from './bazar-ui.utils';

/**
 * Только компоненты — константы и хелперы лежат в ./bazar-ui.utils
 * (react-refresh/only-export-components: файл с компонентами не должен
 * экспортировать функции/константы, иначе Fast Refresh ломается).
 */

/** Аватар Базара: тёмная плитка с тонкой зелёной рамкой, мятная корзина. */
export function BazarAvatar({ size = 44 }: { size?: number }) {
  return (
    <div
      className="shrink-0 rounded-2xl flex items-center justify-center"
      style={{
        width: size,
        height: size,
        background: '#0d1210',
        border: '1px solid rgba(34,197,94,0.25)',
      }}
    >
      <ShoppingBasket size={Math.round(size * 0.5)} strokeWidth={2} style={{ color: MINT }} />
    </div>
  );
}

/** Индикатор «Базар думает»: три спокойные мятные точки, плавное изменение прозрачности. */
export function BazarDots() {
  return (
    <div className="flex items-center gap-1.5 px-1 py-1">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="w-2 h-2 rounded-full"
          style={{ background: MINT }}
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.18, ease: 'easeInOut' }}
        />
      ))}
    </div>
  );
}

/**
 * Мини-карточка товара/поста: тёмная плитка, тонкая зелёная рамка, монохромная иконка.
 *
 * Проп называется `item`, а не `ref`: имя `ref` в React зарезервировано под
 * ссылку на DOM-узел, и правило react-hooks/refs справедливо считает любое
 * обращение к такому пропу чтением ref во время рендера.
 */
export function BazarRefCard({ item, large = false }: { item: BazarRef; large?: boolean }) {
  const st = REF_STYLE[item.type] ?? REF_STYLE.PRODUCT;
  const image = item.media?.[0];
  const hasImage = !!image;
  return (
    <Link
      to={refHref(item)}
      className={`group block shrink-0 transition-transform duration-200 hover:-translate-y-0.5 ${large ? 'w-[240px]' : 'w-[200px]'}`}
    >
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: '#0d1210',
          border: '1px solid rgba(34,197,94,0.18)',
        }}
      >
        {hasImage && (
          <div className={`relative overflow-hidden ${large ? 'h-28' : 'h-24'}`}>
            <img
              src={image}
              alt={item.title ?? ''}
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0b0e0d] via-transparent to-transparent" />
          </div>
        )}
        <div className={`relative p-3 ${hasImage ? '' : 'pt-3'}`}>
          <div
            className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider ${hasImage ? '' : 'mb-2'}`}
            style={{ color: NEON_GREEN }}
          >
            {st.icon}
            {st.label}
          </div>
          <div className="text-[13px] font-semibold text-white leading-snug line-clamp-2 mt-1">
            {item.title || st.label}
          </div>
          {item.price != null && (
            <div className="mt-1.5 text-[13px] font-bold" style={{ color: MINT }}>
              {formatPrice(item.price)}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

/** Строка карточек refs с горизонтальной прокруткой. */
export function BazarRefRow({ refs, large = false }: { refs: BazarRef[]; large?: boolean }) {
  if (!refs || refs.length === 0) return null;
  return (
    <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 mt-3 w-full min-w-0 max-w-full [scrollbar-width:thin] [scrollbar-color:rgba(34,197,94,0.4)_transparent]">
      {refs.map((r, i) => (
        <BazarRefCard key={i} item={r} large={large} />
      ))}
    </div>
  );
}