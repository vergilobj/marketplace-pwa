import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CreateProductPage from './CreateProductPage';
import * as productsApi from '../api/products';

/**
 * Форма создания товара: поле «Описание» обязано быть многострочным.
 *
 * Прецедент (2026-09-15, жалоба владельца): здесь стоял однострочный <Input>,
 * а onResult диктовки ЗАМЕНЯЛ описание целиком. Заполнить длинное описание
 * было невозможно: окно в одну строку, Enter отправлял форму и «выкидывал»
 * из поля валидацией required, микрофон стирал написанное.
 *
 * Позже (то же ТЗ, 2026-09-15) микрофон отсюда убрали совсем — остаётся
 * только многострочное поле.
 */

vi.mock('../api/products', () => ({
  createProduct: vi.fn(),
}));

vi.mock('../api/upload', () => ({
  uploadImage: vi.fn(),
  uploadVideo: vi.fn(),
}));

const createProduct = vi.mocked(productsApi.createProduct);

function renderPage() {
  return render(
    <MemoryRouter>
      <CreateProductPage />
    </MemoryRouter>,
  );
}

const descriptionField = () =>
  screen.getByLabelText('Описание') as HTMLTextAreaElement;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CreateProductPage — поле «Описание»', () => {
  it('многострочное: это <textarea> с запасом строк, а не <input>', () => {
    renderPage();
    const field = descriptionField();
    expect(field.tagName).toBe('TEXTAREA');
    expect(Number(field.rows)).toBeGreaterThanOrEqual(5);
  });

  it('сохраняет переводы строк (однострочный <input> их съедает)', () => {
    renderPage();
    const field = descriptionField();
    fireEvent.change(field, { target: { value: 'Первая строка\nВторая строка' } });
    expect(field.value).toBe('Первая строка\nВторая строка');
    expect(field.value).toContain('\n');
  });

  it('уходит на сервер целиком, вместе с переносами', async () => {
    const { container } = renderPage();
    const title = container.querySelector(
      'input:not([type="file"]):not([type="number"])',
    ) as HTMLInputElement;
    const price = container.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(title, { target: { value: 'Компрессор' } });
    fireEvent.change(descriptionField(), { target: { value: 'Строка 1\nСтрока 2' } });
    fireEvent.change(price, { target: { value: '100' } });

    fireEvent.click(screen.getByRole('button', { name: /Создать товар/i }));

    await waitFor(() => {
      expect(createProduct).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'Строка 1\nСтрока 2' }),
      );
    });
  });
});