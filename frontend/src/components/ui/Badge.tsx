import React from 'react';

export type BadgeTone = 'neutral' | 'accent' | 'amber' | 'danger' | 'muted';

interface BadgeProps {
  text: string;
  /** @deprecated используйте `tone` */
  color?: string;
  tone?: BadgeTone;
  icon?: React.ReactNode;
  className?: string;
}

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-[rgba(255,255,255,0.06)] text-[var(--color-muted)] border border-[rgba(255,255,255,0.08)]',
  accent: 'bg-[rgba(34,197,94,0.12)] text-[#22c55e] border border-[rgba(34,197,94,0.25)]',
  amber: 'bg-[rgba(255,213,102,0.12)] text-amber-300 border border-[rgba(255,213,102,0.22)]',
  danger: 'bg-[rgba(248,113,113,0.12)] text-red-400 border border-[rgba(248,113,113,0.22)]',
  muted: 'bg-[var(--bg-3)] text-[var(--color-faint)]',
};

/** R17 — бейдж под тёмную тему. Для «РЕКЛАМА» используйте tone="amber". */
const Badge: React.FC<BadgeProps> = ({ text, color, tone = 'neutral', icon, className = '' }) => (
  <span
    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium leading-[1.4] ${
      color ? color : tones[tone]
    } ${className}`}
  >
    {icon}
    {text}
  </span>
);

export default Badge;