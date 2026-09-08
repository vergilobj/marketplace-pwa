// Утилиты телефона. Маска — через react-input-mask в компонентах.
// Здесь только чистые функции: формат для показа и снятие маски для API.

/** Сырой "79000000000" → "+7 (900) 000-00-00" для отображения. */
export function formatPhone(raw: string): string {
  const d = digits(raw);
  if (d.length === 0) return '';
  const norm = d.startsWith('8') && d.length === 11 ? '7' + d.slice(1) : d;
  const body = norm.replace(/^7/, '');
  const b = body.slice(0, 10);
  if (!norm.startsWith('7') && norm.length > 0) {
    // без ведущей 7 — просто цифры
    return b;
  }
  let out = '+7';
  if (b.length >= 1) out += ' (' + b.slice(0, 3);
  if (b.length >= 4) out += ') ' + b.slice(3, 6);
  if (b.length >= 7) out += '-' + b.slice(6, 8);
  if (b.length >= 9) out += '-' + b.slice(8, 10);
  if (b.length > 0 && b.length < 4) out = '+7 (' + b.slice(0, 3);
  return out;
}

/** Из любой строки → только цифры. */
export function digits(s: string): string {
  return (s || '').replace(/\D/g, '');
}

/** Снимает маску → сырой "79000000000" для API. */
export function unformatPhone(v: string): string {
  const d = digits(v);
  if (d.startsWith('8') && d.length === 11) return '7' + d.slice(1);
  if (!d.startsWith('7') && d.length === 10) return '7' + d;
  return d;
}