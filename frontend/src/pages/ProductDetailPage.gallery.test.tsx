import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ProductDetailPage from './ProductDetailPage';
import { AppContext, type AppContextType } from '../context/AppContext';
import * as productsApi from '../api/products';
import * as ordersApi from '../api/orders';

/**
 * J1: галерея товара — видео ПЕРВЫМ слайдом (buildGallery), фото после.
 *
 * Инварианты, которые нельзя потерять:
 *  - товар с видео-ФАЙЛОМ → первый слайд это <video>, в галерее N+1 слайд;
 *  - товар с видео-ССЫЛКОЙ (Яндекс/Google/Telegram) → buildGallery такое
 *    в слайды не кладёт, но ссылка обязана остаться видимой на странице;
 *  - товар БЕЗ видео → первое фото как раньше, галерея не вырождается;
 *  - кнопка «Купить» и счётчик количества не задеты правкой галереи.
 */

vi.mock('../api/products', () => ({
  getProductById: vi.fn(),
  getSimilarProducts: vi.fn(),
}));

vi.mock('../api/orders', () => ({
  createOrder: vi.fn(),
  getOrderPaymentStatus: vi.fn(),
}));

const getProductById = vi.mocked(productsApi.getProductById);
const getSimilarProducts = vi.mocked(productsApi.getSimilarProducts);

const VIDEO_FILE = 'http://localhost:3000/uploads/videos/demo.mp4';

const baseProduct = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'p1',
  title: 'Гаражный компрессор',
  description: 'Описание',
  price: 5000,
  media: ['/uploads/a.jpg', '/uploads/b.jpg'],
  sellerId: 's1',
  seller: { id: 's1', name: 'Продавец' },
  ...over,
});

const contextValue: AppContextType = {
  cart: [],
  addToCart: vi.fn(),
  removeFromCart: vi.fn(),
  updateQuantity: vi.fn(),
  moveToFavorites: vi.fn(),
  clearCart: vi.fn(),
  favorites: [],
  toggleFavorite: vi.fn(),
  isFavorite: vi.fn(() => false),
};

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/products/p1']}>
      <AppContext.Provider value={contextValue}>
        <Routes>
          <Route path="/products/:id" element={<ProductDetailPage />} />
        </Routes>
      </AppContext.Provider>
    </MemoryRouter>,
  );

/** Ждём загрузку товара: заголовок появляется только после getProductById. */
const waitLoaded = () =>
  waitFor(() => expect(screen.getByText('Гаражный компрессор')).toBeTruthy());

beforeEach(() => {
  vi.clearAllMocks();
  getSimilarProducts.mockResolvedValue([]);
});

describe('ProductDetailPage — галерея с видео первым слайдом (J1)', () => {
  it('товар с видео-файлом: первым слайдом <video>, фото идут после', async () => {
    getProductById.mockResolvedValue(baseProduct({ videoUrl: VIDEO_FILE }) as never);

    const { container } = renderPage();
    await waitLoaded();

    const videos = container.querySelectorAll('video');
    expect(videos).toHaveLength(1);
    expect(videos[0].getAttribute('src')).toBe('/uploads/videos/demo.mp4');

    // Галерея = видео + 2 фото → 3 таумбнейла (первый — «Видео», далее «Фото 1», «Фото 2»)
    const thumbnails = container.querySelectorAll('button[aria-label="Видео"], button[aria-label^="Фото"]');
    expect(thumbnails).toHaveLength(3);

    // Видео-слайд помечен подписью «видео»
    expect(screen.getByText('видео')).toBeTruthy();

    // Старого отдельного блока «Видео» под галереей быть не должно
    expect(screen.queryByText('Открыть видео')).toBeNull();
  });

  it('товар с видео-файлом: видео именно ПЕРВЫЙ слайд (таумбнейл №1)', async () => {
    getProductById.mockResolvedValue(baseProduct({ videoUrl: VIDEO_FILE }) as never);

    const { container } = renderPage();
    await waitLoaded();

    const thumbnails = Array.from(
      container.querySelectorAll('button[aria-label="Видео"], button[aria-label^="Фото"]'),
    );
    expect(thumbnails[0]?.getAttribute('aria-label')).toBe('Видео');
    expect(thumbnails[1]?.getAttribute('aria-label')).toBe('Фото 1');
    expect(thumbnails[2]?.getAttribute('aria-label')).toBe('Фото 2');

    // Фото-таумбнейлы — реальные <img>, у видео-слайда картинки нет
    expect(thumbnails[0]?.querySelector('img')).toBeNull();
    expect(thumbnails[1]?.querySelector('img')).toBeTruthy();
  });

  it('товар с видео-ССЫЛКОЙ (Яндекс.Диск): ссылка отображается, в слайды не попадает', async () => {
    getProductById.mockResolvedValue(
      baseProduct({ videoUrl: 'https://disk.yandex.ru/d/abcdef12345' }) as never,
    );

    const { container } = renderPage();
    await waitLoaded();

    // Ссылка на месте — путь не потерян
    const link = screen.getByText(/Открыть видео/);
    expect(link.closest('a')?.getAttribute('href')).toBe('https://disk.yandex.ru/d/abcdef12345');
    expect(screen.getByText(/Яндекс\.Диск/)).toBeTruthy();

    // В галерее только фото — 2 слайда, видео-элементов нет
    expect(container.querySelectorAll('video')).toHaveLength(0);
    expect(container.querySelectorAll('iframe')).toHaveLength(0);
    const thumbnails = container.querySelectorAll('button[aria-label^="Фото"]');
    expect(thumbnails).toHaveLength(2);
    expect(screen.queryByText('видео')).toBeNull();
  });

  it('товар с видео-ССЫЛКОЙ Telegram: ссылка так же отображается', async () => {
    getProductById.mockResolvedValue(
      baseProduct({ videoUrl: 'https://t.me/somechannel/42' }) as never,
    );

    renderPage();
    await waitLoaded();

    expect(screen.getByText(/Открыть видео/)).toBeTruthy();
    expect(screen.getByText(/Telegram/)).toBeTruthy();
  });

  it('товар БЕЗ видео: первым слайдом фото, как раньше', async () => {
    getProductById.mockResolvedValue(baseProduct({ videoUrl: null }) as never);

    const { container } = renderPage();
    await waitLoaded();

    expect(container.querySelectorAll('video')).toHaveLength(0);
    const thumbs = container.querySelectorAll('button[aria-label^="Фото"]');
    expect(thumbs).toHaveLength(2);
    expect(screen.queryByText('Открыть видео')).toBeNull();
  });

  it('товар без медиа и без видео: галерея не падает, «Купить» на месте', async () => {
    getProductById.mockResolvedValue(baseProduct({ media: [], videoUrl: null }) as never);

    renderPage();
    await waitLoaded();

    // Кнопка покупки не задета правкой галереи (десктопный вариант есть всегда)
    expect(screen.getAllByText('Купить').length).toBeGreaterThan(0);
    expect(screen.getAllByText('В корзину').length).toBeGreaterThan(0);
  });

  it('кнопка «Купить» и количество работают после перехода на buildGallery', async () => {
    getProductById.mockResolvedValue(baseProduct({ videoUrl: VIDEO_FILE }) as never);
    vi.mocked(ordersApi.createOrder).mockResolvedValue({
      id: 'o1',
      payment: { depositAddress: null, status: 'PENDING' },
    } as never);

    renderPage();
    await waitLoaded();

    const buy = screen.getAllByText('Купить')[0] as HTMLElement;
    expect(buy.closest('button')?.disabled).toBe(false);

    // «+» количества увеличивает итог: 5000 -> 10 000
    const plus = screen.getAllByLabelText('Увеличить количество')[0];
    fireEvent.click(plus);

    await waitFor(() => expect(screen.getAllByText(/10 000 USDT/).length).toBeGreaterThan(0));
  });
});