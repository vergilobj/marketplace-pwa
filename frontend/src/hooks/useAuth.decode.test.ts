import { describe, it, expect } from 'vitest';
import { decodeJwtPayload } from './useAuth';

/** base64url-энкодер как в JWT (RFC 7515): `-`/`_`, без padding. */
function b64url(obj: object): string {
  const json = JSON.stringify(obj);
  const utf8 = new TextEncoder().encode(json);
  let bin = '';
  utf8.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function token(payload: object): string {
  return `header.${b64url(payload)}.signature`;
}

describe('decodeJwtPayload', () => {
  it('декодирует обычный payload', () => {
    const p = decodeJwtPayload(token({ sub: 'user-1', role: 'BUYER' }));
    expect(p?.sub).toBe('user-1');
    expect(p?.role).toBe('BUYER');
  });

  it('НЕ падает на base64url-символах - и _ (регресс бага AA1-1)', () => {
    // Раньше здесь был raw atob → InvalidCharacterError → логин залипал на /login.
    // Подбираем payload, чей base64url-сегмент реально содержит `-` или `_`.
    let seg = '';
    let payload: Record<string, unknown> | null = null;
    for (let i = 0; i < 5000; i++) {
      const cand = { sub: `u${i}~~~`, role: 'BUYER', n: i * 7 };
      const s = b64url(cand);
      if (s.includes('-') || s.includes('_')) { seg = s; payload = cand; break; }
    }
    expect(payload, 'не нашли payload с base64url-символом').not.toBeNull();
    const decoded = decodeJwtPayload(`h.${seg}.s`);
    expect(decoded?.role).toBe('BUYER');
    expect(decoded?.sub).toBe(payload!.sub);
  });

  it('декодирует кириллицу в payload (UTF-8)', () => {
    const p = decodeJwtPayload(token({ sub: 'u1', name: 'Егор' })) as Record<string, unknown> | null;
    expect(p?.['name']).toBe('Егор');
  });

  it('возвращает null на битом токене вместо throw', () => {
    expect(decodeJwtPayload('not-a-jwt')).toBeNull();
    expect(decodeJwtPayload('a.!!!invalid!!!.c')).toBeNull();
    expect(decodeJwtPayload('')).toBeNull();
    expect(decodeJwtPayload(null)).toBeNull();
    expect(decodeJwtPayload(undefined)).toBeNull();
  });

  it('не бросает на токене без payload-сегмента', () => {
    expect(() => decodeJwtPayload('onlyone')).not.toThrow();
    expect(decodeJwtPayload('onlyone')).toBeNull();
  });
});