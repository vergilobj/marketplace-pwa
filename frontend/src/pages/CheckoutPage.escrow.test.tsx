import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CheckoutPage from './CheckoutPage';
import { AppContext, type AppContextType } from '../context/AppContext';

/**
 * J1: на чекауте покупатель должен понимать, что деньги идут в эскроу.
 * До правки слова «эскроу» на странице не было вообще (grep давал 0).
 */

vi.mock('../api/orders', () => ({
  createOrder: vi.fn(),
  getOrderPaymentStatus: vi.fn(),
}));

const contextWithCart = (): AppContextType => ({
  cart: [{ productId: 'p1', title: 'Компрессор', price: 5000, quantity: 1 }],
  addToCart: vi.fn(),
  removeFromCart: vi.fn(),
  updateQuantity: vi.fn(),
  moveToFavorites: vi.fn(),
  clearCart: vi.fn(),
  favorites: [],
  toggleFavorite: vi.fn(),
  isFavorite: vi.fn(() => false),
});

const renderPage = (ctx: AppContextType) =>
  render(
    <MemoryRouter initialEntries={['/checkout']}>
      <AppContext.Provider value={ctx}>
        <CheckoutPage />
      </AppContext.Provider>
    </MemoryRouter>,
  );

beforeEach(() => vi.clearAllMocks());

describe('CheckoutPage — эскроу-текст (J1)', () => {
  it('на чекауте с корзиной видно объяснение эскроу', () => {
    renderPage(contextWithCart());

    expect(screen.getByText(/замораживаются в эскроу/i)).toBeTruthy();
    expect(
      screen.getByText(/уходят продавцу только после того, как вы подтвердите получение заказа/i),
    ).toBeTruthy();
  });

  it('формулировка совпадает с ProductDetailPage (единый текст на всех экранах)', () => {
    renderPage(contextWithCart());

    const el = screen.getByText(/замораживаются в эскроу/i);
    const full = (el.textContent || '').replace(/\s+/g, ' ').trim();

    expect(full).toBe(
      'Деньги замораживаются в эскроу и уходят продавцу только после того, как вы подтвердите получение заказа. Как только оплата дойдёт, продавец получит уведомление и начнёт сборку заказа.',
    );
  });

  it('пустая корзина по-прежнему показывает «Пусто» и не тянет эскроу-блок', () => {
    renderPage({ ...contextWithCart(), cart: [] });

    expect(screen.getByText('Пусто')).toBeTruthy();
    expect(screen.queryByText(/замораживаются в эскроу/i)).toBeNull();
  });
});