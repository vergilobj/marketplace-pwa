import type { ReactNode } from 'react';
import { Package, MessageSquare, User, Receipt } from 'lucide-react';
import type { BazarRef } from '../../api/bazar';
import { formatPrice as formatPriceImpl } from '../../utils/format';

/**
 * Не-компонентная часть Базара (константы, хелперы, стили).
 * Вынесено из bazar-ui.tsx: файл с компонентами не должен экспортировать
 * функции/константы, иначе ломается Fast Refresh (react-refresh/only-export-components).
 */

export const NEON_GREEN = '#22c55e';
export const MINT = '#34d399';

export const REF_STYLE: Record<string, { icon: ReactNode; label: string }> = {
  PRODUCT: { icon: <Package size={13} />, label: 'Товар' },
  POST: { icon: <MessageSquare size={13} />, label: 'Пост' },
  USER: { icon: <User size={13} />, label: 'Продавец' },
  ORDER: { icon: <Receipt size={13} />, label: 'Заказ' },
};

export function refHref(item: BazarRef): string {
  switch (item.type) {
    case 'PRODUCT':
      return `/products/${item.id}`;
    case 'POST':
      return `/posts/${item.id}`;
    case 'USER':
      return `/profile`;
    case 'ORDER':
      return `/orders`;
    default:
      return '/';
  }
}

/** R22: единый формат цены — тот же, что в utils/format (один источник истины). */
export const formatPrice = formatPriceImpl;