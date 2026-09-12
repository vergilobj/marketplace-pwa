import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import FavoritesPage from './FavoritesPage';
import { AppContext, type AppContextType } from '../context/AppContext';
import * as productsApi from '../api/products';

/**
 * L2: FavoritesPage больше не тянет каталог.
 *
 * Ключевые инварианты, которые здесь проверяются:
 *  - НЕТ вызова getProducts (каталога) ни с каким limit — тем более 2000;
 *  - ровно один GET /products/:id на каждый id из избранного;
 *  - товар, который снят/удалён (запрос падает), не ломает страницу —
 *    остальные избранные остаются.
 */

vi.mock('../api/products', () => ({
  getProductById: vi.fn(),
  getProducts: vi.fn(),
}));

const getProductById = vi.mocked(productsApi.getProductById);
const getProducts = vi.mocked(productsApi.getProducts);

const product = (id: string, title: string) => ({
  id,
  title,
  price: 1000,
  media: [],
  sellerId: 's1',
});

const contextValue: AppContextType = {
  cart: [],
  addToCart: vi.fn(),
  removeFromCart: vi.fn(),
  updateQuantity: vi.fn(),
  moveToFavorites: vi.fn(),
  clearCart: vi.fn(),
  favorites: ['p1', 'p2', 'p3'],
  toggleFavorite: vi.fn(),
  isFavorite: vi.fn(() => true),
};

const renderPage = () =>
  render(
    <MemoryRouter>
      <AppContext.Provider value={contextValue}>
        <FavoritesPage />
      </AppContext.Provider>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe('FavoritesPage (L2)', () => {
  it('не тянет каталог: getProducts не вызывается вообще', async () => {
    getProductById.mockImplementation(async (id: string) => product(id, `Товар ${id}`));

    renderPage();
    await waitFor(() => expect(screen.getByText('Товар p1')).toBeTruthy());

    expect(getProducts).not.toHaveBeenCalled();
  });

  it('тянет ровно по id из избранного — по запросу на id', async () => {
    getProductById.mockImplementation(async (id: string) => product(id, `Товар ${id}`));

    renderPage();
    await waitFor(() => expect(screen.getByText('Товар p3')).toBeTruthy());

    expect(getProductById).toHaveBeenCalledTimes(3);
    expect(getProductById.mock.calls.map(c => c[0]).sort()).toEqual(['p1', 'p2', 'p3']);
  });

  it('снятый товар не ломает страницу — остальные избранные на месте', async () => {
    getProductById.mockImplementation(async (id: string) => {
      if (id === 'p2') throw new Error('404');
      return product(id, `Товар ${id}`);
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('Товар p1')).toBeTruthy());

    expect(screen.getByText('Товар p3')).toBeTruthy();
    expect(screen.queryByText('Товар p2')).toBeNull();
    // 3 товара в избранном → 3 запроса, а не 2000 айтемов одним
    expect(getProductById).toHaveBeenCalledTimes(3);
  });

  it('ограничивает параллелизм (не больше 6 запросов одновременно)', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const ids = Array.from({ length: 15 }, (_, i) => `id${i}`);

    contextValue.favorites = ids;
    getProductById.mockImplementation(async (id: string) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(r => setTimeout(r, 5));
      inFlight -= 1;
      return product(id, `Товар ${id}`);
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('Товар id14')).toBeTruthy(), { timeout: 4000 });

    expect(getProductById).toHaveBeenCalledTimes(15);
    expect(maxInFlight).toBeLessThanOrEqual(6);

    contextValue.favorites = ['p1', 'p2', 'p3'];
  });

  /**
   * G3: плюрализация счётчика избранного.
   *
   * Было «{n} товаров» — «1 товаров», «2 товаров». Теперь plural() из
   * utils/format: «1 товар», «2 товара», «5 товаров».
   */
  it('склоняет счётчик: «2 товара», а не «2 товаров»', async () => {
    contextValue.favorites = ['p1', 'p2'];
    getProductById.mockImplementation(async (id: string) => product(id, `Товар ${id}`));

    renderPage();
    await waitFor(() => expect(screen.getByText('Товар p1')).toBeTruthy());

    expect(screen.getByText('2 товара')).toBeTruthy();
    expect(screen.queryByText('2 товаров')).toBeNull();
  });

  it('склоняет счётчик для одного товара: «1 товар»', async () => {
    contextValue.favorites = ['p1'];
    getProductById.mockImplementation(async (id: string) => product(id, `Товар ${id}`));

    renderPage();
    await waitFor(() => expect(screen.getByText('Товар p1')).toBeTruthy());

    expect(screen.getByText('1 товар')).toBeTruthy();
    expect(screen.queryByText('1 товаров')).toBeNull();
  });

  it('склоняет счётчик для пяти: «5 товаров»', async () => {
    contextValue.favorites = ['p1', 'p2', 'p3', 'p4', 'p5'];
    getProductById.mockImplementation(async (id: string) => product(id, `Товар ${id}`));

    renderPage();
    await waitFor(() => expect(screen.getByText('Товар p5')).toBeTruthy());

    expect(screen.getByText('5 товаров')).toBeTruthy();
  });
});