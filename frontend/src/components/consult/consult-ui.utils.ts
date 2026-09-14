import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

/**
 * Не-компонентная часть ИИ-консультанта (константы, хелперы, стили).
 *
 * Вынесено из `ConsultChat.tsx` намеренно: файл с компонентами не должен
 * экспортировать функции/константы, иначе ломается Fast Refresh
 * (react-refresh/only-export-components) — тот же приём, что в
 * `components/bazar/bazar-ui.utils.tsx`.
 */

export const NEON_GREEN = '#22c55e';
export const MINT = '#34d399';

/** Подпись источника ответа. Ключи — `CONSULT_SOURCES` с бэкенда. */
export const SOURCE_LABELS: Record<string, string> = {
  KNOWLEDGE: 'Из базы знаний',
  CATALOG: 'По товарам',
  LLM: 'Ответ ИИ',
  FALLBACK: 'Передано админу',
};

/**
 * Подпись бейджа «ИИ» на пузыре. Требование ТЗ: ответ ИИ обязан быть помечен,
 * чтобы юзер не путал его со словами живого администратора.
 */
export const AI_BADGE = 'ИИ';

/** Бейдж живого админа (используется в треде обращений). */
export const ADMIN_BADGE = 'Админ';

/** Стиль пузыря ассистента — как в Базаре (одна визуальная система). */
export const AI_BUBBLE_STYLE = {
  background: '#0d1210',
  border: '1px solid rgba(34,197,94,0.18)',
} as const;

/** Стиль пузыря пользователя. */
export const USER_BUBBLE_CLASS =
  'bg-[#22c55e] text-[#0b0e0d] rounded-2xl rounded-br-md px-4 py-3 font-medium';

/** Человеческое время сообщения. */
export function formatConsultTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return format(d, 'd MMM, HH:mm', { locale: ru });
}

/** Уверенность в процентах — для подписи под ответом из базы знаний. */
export function confidencePercent(value?: number | null): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '';
  return `${Math.round(value * 100)}%`;
}