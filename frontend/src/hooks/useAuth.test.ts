import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

function base64urlEncode(obj: object): string {
  const json = JSON.stringify(obj);
  return btoa(json).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// Must import after mock
import { useAuth } from './useAuth';
import { renderHook } from '@testing-library/react';

describe('useAuth', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('returns unauthenticated when no token', () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.isSeller).toBe(false);
    expect(result.current.isBuyer).toBe(false);
  });

  it('parses BUYER token correctly', () => {
    const header = base64urlEncode({ alg: 'HS256' });
    const payload = base64urlEncode({ sub: 'user-1', role: 'BUYER' });
    localStorageMock.setItem('accessToken', `${header}.${payload}.signature`);

    const { result } = renderHook(() => useAuth());
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user?.id).toBe('user-1');
    expect(result.current.user?.role).toBe('BUYER');
    expect(result.current.isBuyer).toBe(true);
    expect(result.current.isSeller).toBe(false);
    expect(result.current.isAdmin).toBe(false);
  });

  it('parses SELLER token correctly', () => {
    const header = base64urlEncode({ alg: 'HS256' });
    const payload = base64urlEncode({ sub: 'seller-1', role: 'SELLER' });
    localStorageMock.setItem('accessToken', `${header}.${payload}.signature`);

    const { result } = renderHook(() => useAuth());
    expect(result.current.isSeller).toBe(true);
    expect(result.current.isBuyer).toBe(false);
  });

  it('parses ADMIN token correctly', () => {
    const header = base64urlEncode({ alg: 'HS256' });
    const payload = base64urlEncode({ sub: 'admin-1', role: 'ADMIN' });
    localStorageMock.setItem('accessToken', `${header}.${payload}.signature`);

    const { result } = renderHook(() => useAuth());
    expect(result.current.isAdmin).toBe(true);
  });

  it('returns null user for invalid token', () => {
    localStorageMock.setItem('accessToken', 'invalid.token.here');
    const { result } = renderHook(() => useAuth());
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });
});
