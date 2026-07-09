import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { AppProvider, useApp } from './AppContext';

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

// Reset store and mock implementations before each test suite
beforeEach(() => {
  localStorageMock.clear();
  localStorageMock.getItem.mockImplementation((key: string) => null);
  vi.clearAllMocks();
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AppProvider>{children}</AppProvider>
);

describe('AppContext', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  describe('cart', () => {
    it('starts with empty cart', () => {
      const { result } = renderHook(() => useApp(), { wrapper });
      expect(result.current.cart).toEqual([]);
    });

    it('adds item to cart', () => {
      const { result } = renderHook(() => useApp(), { wrapper });
      act(() => {
        result.current.addToCart({ id: 'prod-1', title: 'Test', price: 100 });
      });
      expect(result.current.cart).toHaveLength(1);
      expect(result.current.cart[0].productId).toBe('prod-1');
      expect(result.current.cart[0].quantity).toBe(1);
    });

    it('increments quantity for existing item', () => {
      const { result } = renderHook(() => useApp(), { wrapper });
      act(() => {
        result.current.addToCart({ id: 'prod-1', title: 'Test', price: 100 });
      });
      act(() => {
        result.current.addToCart({ id: 'prod-1', title: 'Test', price: 100 });
      });
      expect(result.current.cart).toHaveLength(1);
      expect(result.current.cart[0].quantity).toBe(2);
    });

    it('removes item from cart', () => {
      const { result } = renderHook(() => useApp(), { wrapper });
      act(() => {
        result.current.addToCart({ id: 'prod-1', title: 'Test', price: 100 });
      });
      act(() => {
        result.current.removeFromCart('prod-1');
      });
      expect(result.current.cart).toHaveLength(0);
    });

    it('updates quantity with delta', () => {
      const { result } = renderHook(() => useApp(), { wrapper });
      act(() => {
        result.current.addToCart({ id: 'prod-1', title: 'Test', price: 100 });
      });
      act(() => {
        result.current.updateQuantity('prod-1', 2);
      });
      expect(result.current.cart[0].quantity).toBe(3);
    });

    it('removes item when quantity goes to zero', () => {
      const { result } = renderHook(() => useApp(), { wrapper });
      act(() => {
        result.current.addToCart({ id: 'prod-1', title: 'Test', price: 100 });
      });
      act(() => {
        result.current.updateQuantity('prod-1', -1);
      });
      expect(result.current.cart).toHaveLength(0);
    });

    it('clears entire cart', () => {
      const { result } = renderHook(() => useApp(), { wrapper });
      act(() => {
        result.current.addToCart({ id: 'prod-1', title: 'A', price: 100 });
        result.current.addToCart({ id: 'prod-2', title: 'B', price: 200 });
      });
      act(() => {
        result.current.clearCart();
      });
      expect(result.current.cart).toHaveLength(0);
    });

    it('persists cart to localStorage', () => {
      const { result } = renderHook(() => useApp(), { wrapper });
      act(() => {
        result.current.addToCart({ id: 'prod-1', title: 'Test', price: 100 });
      });
      expect(localStorageMock.setItem).toHaveBeenCalled();
    });

    it('restores cart from localStorage', () => {
      localStorageMock.getItem.mockReturnValue(JSON.stringify([
        { productId: 'saved', title: 'Saved', price: 50, quantity: 1 },
      ]));
      const { result } = renderHook(() => useApp(), { wrapper });
      expect(result.current.cart).toHaveLength(1);
      expect(result.current.cart[0].productId).toBe('saved');
    });
  });

  describe('favorites', () => {
    it('starts with empty favorites', () => {
      const { result } = renderHook(() => useApp(), { wrapper });
      expect(result.current.favorites).toEqual([]);
    });

    it('toggles favorite on', () => {
      const { result } = renderHook(() => useApp(), { wrapper });
      act(() => {
        result.current.toggleFavorite('prod-1');
      });
      expect(result.current.isFavorite('prod-1')).toBe(true);
      expect(result.current.favorites).toContain('prod-1');
    });

    it('toggles favorite off', () => {
      const { result } = renderHook(() => useApp(), { wrapper });
      act(() => {
        result.current.toggleFavorite('prod-1');
      });
      act(() => {
        result.current.toggleFavorite('prod-1');
      });
      expect(result.current.isFavorite('prod-1')).toBe(false);
    });

    it('persists favorites to localStorage', () => {
      const { result } = renderHook(() => useApp(), { wrapper });
      act(() => {
        result.current.toggleFavorite('prod-1');
      });
      expect(localStorageMock.setItem).toHaveBeenCalled();
    });
  });

  describe('moveToFavorites', () => {
    it('moves item from cart to favorites', () => {
      const { result } = renderHook(() => useApp(), { wrapper });
      act(() => {
        result.current.addToCart({ id: 'prod-1', title: 'Test', price: 100 });
      });
      act(() => {
        result.current.moveToFavorites('prod-1');
      });
      expect(result.current.cart).toHaveLength(0);
      expect(result.current.isFavorite('prod-1')).toBe(true);
    });
  });
});
