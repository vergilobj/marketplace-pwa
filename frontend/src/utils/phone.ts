// Маска телефона +7 (XXX) XXX-XX-XX поверх сырого формата 79000000000 (11 цифр).

/** Сырой "79000000000" (или уже с маской) → "+7 (900) 000-00-00". Идемпотентна. */
export function formatPhone(raw: string): string {
  const d = digits(raw);
  if (d.length === 0) return '';
  // ведущий 8 → 7
  const norm = d.startsWith('8') && d.length === 11 ? '7' + d.slice(1) : d;
  const body = norm.startsWith('7') ? norm.slice(1) : norm;
  const b = body.slice(0, 10);
  if (b.length < 3) return '+7 ' + b;
  if (b.length < 6) return `+7 (${b.slice(0, 3)}) ${b.slice(3)}`;
  if (b.length < 8) return `+7 (${b.slice(0, 3)}) ${b.slice(3, 6)}-${b.slice(6)}`;
  return `+7 (${b.slice(0, 3)}) ${b.slice(3, 6)}-${b.slice(6, 8)}-${b.slice(8, 10)}`;
}

/** Живой ввод: оставляет только цифры и накладывает маску по мере набора. */
export function maskPhoneInput(v: string): string {
  let d = digits(v);
  // если юзер стирает +7 (8) — трактуем как 7
  if (d.startsWith('8') && d.length <= 11) d = '7' + d.slice(1);
  if (!d.startsWith('7') && d.length > 0 && d.length <= 10) d = '7' + d;
  // максимум 11 цифр (7 + 10)
  d = d.slice(0, 11);
  return formatPhone(d);
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