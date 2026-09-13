/**
 * COSMETIC-2 — страница «нет доступа».
 *
 * Раньше ProtectedRoute при неподходящей роли молча делал <Navigate to="/" />:
 * покупатель попадал на ленту без единого слова о причине (замер CDP 2026-09-13:
 * /leads, /my-products, /products/new, /posts/ad/new, /admin → URL «/»,
 * тостов нет, h1 «Твой рынок»).
 *
 * Теперь на закрытом маршруте рендерится ЭТА страница: адрес остаётся прежним,
 * объяснение — на месте, а доступ по-прежнему закрыт: компонент закрытого
 * раздела не монтируется вообще, ни один его запрос не уходит. Guard не ослаблен.
 *
 * Лежит в components/, а не в pages/, намеренно: pages/ — это lazy-чанки
 * (см. App.tsx), а заглушка нужна сразу, без ожидания подгрузки.
 */
import { ShieldAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Button from './ui/Button';

interface Props {
  /** Заголовок — что за раздел. */
  title?: string;
  /** Человеческое объяснение, почему раздел недоступен. */
  description?: string;
  /** Куда ведёт кнопка. */
  homePath?: string;
  homeLabel?: string;
}

export default function AccessDenied({
  title = 'Раздел недоступен',
  description = 'Для этого раздела нужен другой статус аккаунта. Доступ закрыт, всё остальное работает как обычно.',
  homePath = '/',
  homeLabel = 'На главную',
}: Props) {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
      <div className="w-20 h-20 mb-5 rounded-full bg-[var(--color-surface)] flex items-center justify-center text-[var(--color-faint)]">
        <ShieldAlert size={32} />
      </div>
      <h1 className="text-lg font-semibold text-[var(--color-text)] mb-1.5">{title}</h1>
      <p className="text-sm text-[var(--color-muted)] max-w-xs">{description}</p>
      <Button variant="primary" className="mt-6" onClick={() => navigate(homePath)}>
        {homeLabel}
      </Button>
    </div>
  );
}