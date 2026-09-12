import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

/**
 * BUG-2: роль в UI не обновлялась после одобрения заявки продавца.
 *
 * Проверяем, что состояние роли перезапрашивается с сервера и перебивает
 * устаревший клейм access-токена (BUYER → SELLER без перелогина), и что
 * guard не редиректит, пока проверка роли не завершена.
 */

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

vi.mock('../api/users', () => ({
  getProfile: vi.fn(),
  becomeSeller: vi.fn(),
}));

import { useAuth, refreshAuth, clearAuthState, decodeJwtPayload } from './useAuth';
import { getProfile, becomeSeller } from '../api/users';

function token(payload: object): string {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  const seg = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `header.${seg}.signature`;
}

const BUYER_TOKEN = token({ sub: 'user-1', role: 'BUYER' });
const SELLER_TOKEN = token({ sub: 'user-1', role: 'SELLER' });

describe('BUG-2: ре-фетч роли', () => {
  beforeEach(() => {
    localStorageMock.clear();
    clearAuthState();
    vi.clearAllMocks();
  });

  it('BUYER в клейме + SELLER на сервере → isSeller без перелогина и новый токен', async () => {
    localStorage.setItem('accessToken', BUYER_TOKEN);
    vi.mocked(getProfile).mockResolvedValue({ id: 'user-1', phone: '+79990000000', role: 'SELLER' });
    vi.mocked(becomeSeller).mockResolvedValue({
      user: { id: 'user-1', phone: '+79990000000', role: 'SELLER' },
      accessToken: SELLER_TOKEN,
    });

    const { result } = renderHook(() => useAuth());
    expect(result.current.isBuyer).toBe(true);
    expect(result.current.isSeller).toBe(false);

    await act(async () => { await refreshAuth(); });

    await waitFor(() => expect(result.current.isSeller).toBe(true));
    expect(result.current.isBuyer).toBe(false);
    expect(result.current.user?.role).toBe('SELLER');
    expect(result.current.rolePending).toBe(false);
    // токен заменён на свежий (иначе API-гарды бэка увидят старую роль)
    expect(localStorage.getItem('accessToken')).toBe(SELLER_TOKEN);
    expect(decodeJwtPayload(localStorage.getItem('accessToken'))?.role).toBe('SELLER');
  });

  it('до окончания проверки роли guard видит rolePending=true', async () => {
    localStorage.setItem('accessToken', BUYER_TOKEN);
    let release: (v: { id: string; phone: string; role: string }) => void = () => {};
    vi.mocked(getProfile).mockReturnValue(new Promise((res) => { release = res as never; }));

    const { result } = renderHook(() => useAuth());
    expect(result.current.rolePending).toBe(true);
    expect(result.current.isBuyer).toBe(true); // клейм ещё виден, но не финальный

    await act(async () => {
      release({ id: 'user-1', phone: '+79990000000', role: 'SELLER' });
      await refreshAuth();
    });
    expect(result.current.rolePending).toBe(false);
    // роль SELLER без become-seller: токен не тронут (клейм уже SELLER? нет — BUYER)
    await waitFor(() => expect(result.current.role).toBe('SELLER'));
  });

  it('понижение роли (админ вернул BUYER) не зовёт become-seller', async () => {
    localStorage.setItem('accessToken', SELLER_TOKEN);
    vi.mocked(getProfile).mockResolvedValue({ id: 'user-1', phone: '+79990000000', role: 'BUYER' });

    const { result } = renderHook(() => useAuth());
    expect(result.current.isSeller).toBe(true);

    await act(async () => { await refreshAuth(); });

    await waitFor(() => expect(result.current.isBuyer).toBe(true));
    expect(becomeSeller).not.toHaveBeenCalled();
    expect(localStorage.getItem('accessToken')).toBe(SELLER_TOKEN);
  });

  it('сеть упала → состояние по токену не ломается, проверка завершается', async () => {
    localStorage.setItem('accessToken', BUYER_TOKEN);
    vi.mocked(getProfile).mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useAuth());
    expect(result.current.rolePending).toBe(true);
    await act(async () => { await refreshAuth(); });

    expect(result.current.isBuyer).toBe(true);
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.rolePending).toBe(false);
  });

  it('повторный refreshAuth для того же токена не бьёт по сети', async () => {
    localStorage.setItem('accessToken', BUYER_TOKEN);
    vi.mocked(getProfile).mockResolvedValue({ id: 'user-1', phone: '+79990000000', role: 'BUYER' });

    await act(async () => { await refreshAuth(); });
    await act(async () => { await refreshAuth(); });
    expect(getProfile).toHaveBeenCalledTimes(1);
  });

  it('логаут: clearAuthState сбрасывает серверную роль', async () => {
    localStorage.setItem('accessToken', BUYER_TOKEN);
    vi.mocked(getProfile).mockResolvedValue({ id: 'user-1', phone: '+79990000000', role: 'SELLER' });
    vi.mocked(becomeSeller).mockResolvedValue({
      user: { id: 'user-1', phone: '+79990000000', role: 'SELLER' },
      accessToken: SELLER_TOKEN,
    });

    const { result } = renderHook(() => useAuth());
    await act(async () => { await refreshAuth(); });
    await waitFor(() => expect(result.current.isSeller).toBe(true));

    await act(async () => {
      localStorageMock.clear();
      clearAuthState();
    });
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.role).toBeNull();
  });
});