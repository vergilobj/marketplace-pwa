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

// ────────────────────────────────────────────────────────────────────────────
// Разбор ответа Базара
//
// LLM отдаёт ответ вместе со служебными блоками прямо в тексте:
//
//   <текст ответа>
//
//   ```refs
//   [...]
//   ```
//
//   ```action
//   {"intent":"none","payload":{}}
//   ```
//
// Бэкенд (bazar.api-client.ts:parseContent) их вырезает, но умеет только
// «закрытую» форму с фенсами и переводом строки сразу после ```refs. Если модель
// съехала (нет закрывающего фенса, фенс потерялся, есть пустая строка после
// маркера) — блок остаётся в тексте и уезжает в БД. Такие старые строки плюс
// «сырые» ответы режем здесь, на клиенте: пользователь не должен видеть
// технический мусор.
// ────────────────────────────────────────────────────────────────────────────

export type BazarBlockKind = 'refs' | 'action';

export interface BazarParsedAction {
  intent: string;
  payload?: Record<string, unknown>;
}

export interface BazarParsed {
  /** Текст без служебных блоков — только его показываем в пузыре. */
  cleanText: string;
  /** Разобранные refs (карточки товаров/постов). */
  refs: BazarRef[];
  /** Разобранный action — идёт в тост, в текст не попадает. */
  action: BazarParsedAction | null;
}

/** ```refs\n...\n``` — закрытый блок. */
const FENCED_RE = /```[ \t]*(refs|action)[ \t]*\r?\n([\s\S]*?)```/g;
/** ```refs\n... — фенс есть, закрывающего ``` нет (до конца текста). */
const UNTERMINATED_RE = /```[ \t]*(refs|action)[ \t]*\r?\n([\s\S]*)$/;
/** Строка-маркер: `refs`, `action`, ```refs, ```action. */
const MARKER_LINE_RE = /^(?:```)?[ \t]*(refs|action)[ \t]*(?:```)?$/;
/** Строка-ограничитель: ``` */
const FENCE_LINE_RE = /^[ \t]*```[ \t]*$/;

function parseRefsBlock(body: string): BazarRef[] | null {
  const trimmed = body.trim();
  if (!trimmed) return null;
  try {
    const value: unknown = JSON.parse(trimmed);
    return Array.isArray(value) ? (value as BazarRef[]) : null;
  } catch {
    return null;
  }
}

function parseActionBlock(body: string): BazarParsedAction | null {
  const trimmed = body.trim();
  if (!trimmed) return null;
  try {
    const value = JSON.parse(trimmed) as BazarParsedAction | null;
    if (
      value &&
      typeof value === 'object' &&
      typeof value.intent === 'string' &&
      value.intent.length > 0
    ) {
      return value;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Вырезает из ответа Базара блоки ```refs и ```action.
 *
 * Понимает три формы:
 *   1. закрытый фенс (```refs ... ```) — как отдаёт бэкенд;
 *   2. незакрытый фенс (```refs ... до конца);
 *   3. голые строки-маркеры `refs` / `action` без фенсов — то, что видно
 *      на скриншоте владельца.
 *
 * Фенс — это явное намерение модели отдать служебный блок, поэтому такой блок
 * вырезаем ВСЕГДА, даже если JSON внутри битый: пользователь не должен видеть
 * технический мусор, а саму реплику терять нельзя. Битые refs просто не
 * превращаются в карточки, битый action — не даёт тоста.
 *
 * Голые маркеры (форма 3) — эвристика: под неё может попасть обычная проза
 * («Действие: ...» отдельной строкой), поэтому такой блок вырезаем только если
 * тело реально распарсилось как JSON. Иначе текст возвращается как есть.
 */
export function parseBazarResponse(raw?: string | null): BazarParsed {
  let text = typeof raw === 'string' ? raw : '';
  let refs: BazarRef[] = [];
  let action: BazarParsedAction | null = null;

  const extract = (kind: string, body: string): void => {
    if (kind === 'refs') {
      const parsed = parseRefsBlock(body);
      if (parsed) refs = parsed;
      return;
    }
    const parsed = parseActionBlock(body);
    if (parsed) action = parsed;
  };

  // 1) Закрытые блоки — вырезаем всегда, извлекаем что валидно.
  text = text.replace(FENCED_RE, (_full: string, kind: string, body: string) => {
    extract(kind, body);
    return '';
  });

  // 2) Незакрытый фенс — блок тянется до конца текста.
  const m = UNTERMINATED_RE.exec(text);
  if (m) {
    extract(m[1], m[2]);
    text = text.slice(0, m.index);
  }

  // 3) Голые маркеры без фенсов: тело блока — строки до следующего маркера/фенса.
  // Здесь вырезаем только валидный JSON (эвристика может задеть прозу).
  const kept: string[] = [];
  let pendingKind: BazarBlockKind | null = null;
  let pendingLines: string[] = [];

  const flush = (): boolean => {
    if (!pendingKind) return true;
    const body = pendingLines.join('\n').trim();
    const ok =
      pendingKind === 'refs'
        ? parseRefsBlock(body) !== null
        : parseActionBlock(body) !== null;
    if (ok) {
      extract(pendingKind, body);
    } else {
      kept.push(pendingKind, ...pendingLines);
    }
    pendingKind = null;
    pendingLines = [];
    return ok;
  };

  for (const line of text.split('\n')) {
    if (pendingKind) {
      if (FENCE_LINE_RE.test(line)) {
        if (!flush()) kept.push(line);
        continue;
      }
      const marker = MARKER_LINE_RE.exec(line.trim());
      if (marker) {
        if (!flush()) kept.push(line);
        pendingKind = marker[1] as BazarBlockKind;
        pendingLines = [];
        continue;
      }
      pendingLines.push(line);
      continue;
    }

    const marker = MARKER_LINE_RE.exec(line.trim());
    if (marker) {
      pendingKind = marker[1] as BazarBlockKind;
      pendingLines = [];
      continue;
    }
    kept.push(line);
  }
  flush();
  text = kept.join('\n');

  // Прибираем пустоты, оставшиеся после вырезанных блоков.
  text = text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { cleanText: text, refs, action };
}