// Маска телефона +7 (XXX) XXX-XX-XX поверх сырого формата 79000000000 (11 цифр).

/** Сырой "79000000000" (или уже с маской) → "+7 (900) 000-00-00". Идемпотентна. */
export function formatPhone(raw: string): string {
  const d = digits(raw);
  if (d.length === 0) return '';
  // ведущий 8 → 7 только если набрано полных 11 цифр
  const norm = d.startsWith('8') && d.length === 11 ? '7' + d.slice(1) : d;
  // префикс «+7 » рисуем только если исходно была 7 или 8 — иначе не навязываем
  const hasPrefix = /^[78]/.test(norm);
  const body = hasPrefix ? norm.slice(1) : norm;
  const b = body.slice(0, 10);
  const prefix = hasPrefix ? '+7 ' : '';
  if (b.length < 3) return prefix + b;
  if (b.length < 6) return `${prefix}(${b.slice(0, 3)}) ${b.slice(3)}`;
  if (b.length < 8) return `${prefix}(${b.slice(0, 3)}) ${b.slice(3, 6)}-${b.slice(6)}`;
  return `${prefix}(${b.slice(0, 3)}) ${b.slice(3, 6)}-${b.slice(6, 8)}-${b.slice(8, 10)}`;
}

/** Живой ввод: цифры + маска на лету, БЕЗ навязывания «7» (чтобы поле можно было стереть). */
export function maskPhoneInput(v: string): string {
  return formatPhone(digits(v).slice(0, 11));
}

/** Снимает маску → сырой "79000000000" для API. */
export function unformatPhone(v: string): string {
  const d = digits(v);
  if (d.startsWith('8') && d.length === 11) return '7' + d.slice(1);
  if (!d.startsWith('7') && d.length === 10) return '7' + d;
  return d;
}

function digits(s: string): string {
  return (s || '').replace(/\D/g, '');
}