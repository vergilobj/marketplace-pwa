import React from 'react';
import { PackageOpen } from 'lucide-react';
import Button from './Button';

type HeadingLevel = 'h1' | 'h2' | 'h3';

interface EmptyStateProps {
  /** Заголовок. Если не передан — берётся `message` (обратная совместимость). */
  title?: string;
  /** @deprecated используйте `title` */
  message?: string;
  /** Поясняющая строка под заголовком */
  description?: string;
  /** Иконка. По умолчанию PackageOpen */
  icon?: React.ReactNode;
  /**
   * G1 — уровень заголовка. По умолчанию `h1`: на страницах, где пустое
   * состояние — единственный контент, это даёт странице реальный заголовок
   * (a11y/SEO). Там, где `h1` уже есть выше (напр. «Избранное»), передавай `h2`.
   */
  headingLevel?: HeadingLevel;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

/**
 * R17 — единое пустое состояние под тёмную тему Базара.
 * Раньше было свёрстано вручную 8 раз по-разному.
 * G1 — заголовок теперь настоящий heading (по умолчанию `h1`), а не `<p>`.
 */
export default function EmptyState({
  title,
  message = 'Здесь пока пусто',
  description,
  icon,
  headingLevel = 'h1',
  action,
  className = '',
}: EmptyStateProps) {
  const heading = title || message;
  const Heading = headingLevel;
  return (
    <div className={`flex flex-col items-center justify-center py-20 px-6 text-center ${className}`}>
      <div className="w-20 h-20 mb-5 rounded-full bg-[var(--color-surface)] flex items-center justify-center text-[var(--color-faint)]">
        {icon ?? <PackageOpen size={32} />}
      </div>
      <Heading className="text-lg font-semibold text-[var(--color-text)] mb-1.5">{heading}</Heading>
      {description && <p className="text-sm text-[var(--color-muted)] max-w-xs">{description}</p>}
      {action && (
        <Button variant="primary" className="mt-6" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}