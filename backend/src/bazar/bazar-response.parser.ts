import type { BazarAction, BazarRef, BazarResponse } from './bazar.api-client';

/**
 * Устойчивый разбор ответа Базара (B2).
 *
 * Зеркало фронтового `parseBazarResponse` (frontend/src/components/bazar/bazar-ui.utils.tsx).
 * LLM отдаёт служебные блоки прямо в тексте:
 *
 *   <текст ответа>
 *
 *   ```refs
 *   [...]
 *   ```
 *
 *   ```action
 *   {"intent":"none","payload":{}}
 *   ```
 *
 * Строгие регулярки старого `parseContent` понимали только «закрытую» форму с
 * переводом строки сразу после ```refs. Если модель съехала (нет закрывающего
 * фенса, фенс потерялся, пустая строка после маркера, битый JSON) — блок
 * оставался в тексте и НАВСЕГДА уезжал в БД как мусор.
 *
 * Здесь понимаем три формы:
 *   1. закрытый фенс  ```refs ... ```   — вырезаем ВСЕГДА, даже если JSON битый;
 *   2. незакрытый фенс ```refs ... до конца текста — вырезаем;
 *   3. голые строки-маркеры `refs` / `action` без фенсов — вырезаем ТОЛЬКО если
 *      тело реально распарсилось как JSON (иначе можно задеть обычную прозу).
 *
 * Битый JSON: блок вырезан, refs = [], action = undefined.
 */

/** ```refs\n...\n``` — закрытый блок. */
const FENCED_RE = /```[ \t]*(refs|action)[ \t]*\r?\n([\s\S]*?)```/g;
/** ```refs\n... — фенс есть, закрывающего ``` нет (до конца текста). */
const UNTERMINATED_RE = /```[ \t]*(refs|action)[ \t]*\r?\n([\s\S]*)$/;
/** Строка-маркер: `refs`, `action`, ```refs, ```action. */
const MARKER_LINE_RE = /^(?:```)?[ \t]*(refs|action)[ \t]*(?:```)?$/;
/** Строка-ограничитель: ``` */
const FENCE_LINE_RE = /^[ \t]*```[ \t]*$/;

type BlockKind = 'refs' | 'action';

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

function parseActionBlock(body: string): BazarAction | null {
  const trimmed = body.trim();
  if (!trimmed) return null;
  try {
    const value = JSON.parse(trimmed) as BazarAction | null;
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
 * Возвращает чистый текст + разобранные refs/action.
 */
export function parseBazarContent(raw: string): BazarResponse {
  let text = typeof raw === 'string' ? raw : '';
  let refs: BazarRef[] = [];
  let action: BazarAction | undefined;

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
  text = text.replace(
    FENCED_RE,
    (_full: string, kind: string, body: string) => {
      extract(kind, body);
      return '';
    },
  );

  // 2) Незакрытый фенс — блок тянется до конца текста.
  const m = UNTERMINATED_RE.exec(text);
  if (m) {
    extract(m[1], m[2]);
    text = text.slice(0, m.index);
  }

  // 3) Голые маркеры без фенсов: `refs` / `action` отдельной строкой.
  // Вырезаем ТОЛЬКО если тело реально распарсилось как JSON (иначе можно
  // задеть обычную прозу). Тело — кратчайший префикс последующих строк,
  // который парсится как валидный JSON; хвост текста после блока не съедаем.
  const lines = text.split('\n');
  const kept: string[] = [];
  const BARE_BODY_MAX_LINES = 200;

  const parseBody = (kind: BlockKind, body: string) =>
    kind === 'refs' ? parseRefsBlock(body) : parseActionBlock(body);

  let i = 0;
  while (i < lines.length) {
    const marker = MARKER_LINE_RE.exec(lines[i].trim());
    if (!marker) {
      kept.push(lines[i]);
      i++;
      continue;
    }

    const kind = marker[1] as BlockKind;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j++; // пустая строка после маркера

    let body = '';
    let matchedAt = -1;
    for (let k = j; k < lines.length && k - j < BARE_BODY_MAX_LINES; k++) {
      body = body ? `${body}\n${lines[k]}` : lines[k];
      if (parseBody(kind, body) !== null) {
        matchedAt = k;
        break;
      }
    }

    if (matchedAt >= 0) {
      extract(kind, body);
      i = matchedAt + 1;
      // Прибираем пустые строки и осиротевший ограничитель ``` после блока.
      while (i < lines.length && lines[i].trim() === '') i++;
      if (i < lines.length && FENCE_LINE_RE.test(lines[i])) i++;
      continue;
    }

    kept.push(lines[i]);
    i++;
  }
  text = kept.join('\n');

  // Прибираем пустоты, оставшиеся после вырезанных блоков.
  text = text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const out: BazarResponse = { text };
  if (refs.length) out.refs = refs;
  if (action) out.action = action;
  return out;
}
