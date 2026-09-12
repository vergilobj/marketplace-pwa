/**
 * FIX-REST фикс 9: кнопка «Показать ещё» на /notifications.
 *
 * История бага: визуальный аудит видел `hasShowMore: false` и решил, что
 * кнопки нет. Кнопка в коде БЫЛА, но PAGE_SIZE=100 делал условие `hasMore`
 * невыполнимым: проверено на боевой БД — максимум 24 уведомления у одного
 * пользователя, пользователей с >=100 — ноль. То есть кнопка была мёртвым
 * кодом.
 *
 * Тест фиксирует контракт: при ровно PAGE_SIZE пришедших уведомлениях
 * кнопка появляется и догружает следующую страницу.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import NotificationsPage from './NotificationsPage';

const PAGE_SIZE = 20;

const getMock = vi.fn();
vi.mock('../api/axios', () => ({
  default: {
    get: (...a: unknown[]) => getMock(...a),
    patch: vi.fn().mockResolvedValue({ data: {} }),
  },
}));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));

const mk = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => ({
    id: `n-${from + i}`,
    type: 'order',
    message: `Уведомление ${from + i}`,
    isRead: true,
    createdAt: new Date().toISOString(),
  }));

describe('NotificationsPage — «Показать ещё» (FIX-REST фикс 9)', () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it('запрашивает первую страницу размером 20, а не 100', async () => {
    getMock.mockResolvedValue({ data: mk(3) });
    render(<NotificationsPage />);
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    expect(getMock).toHaveBeenCalledWith('/notifications', {
      params: { page: 1, limit: PAGE_SIZE },
    });
  });

  it('кнопки НЕТ, когда уведомлений меньше страницы', async () => {
    getMock.mockResolvedValue({ data: mk(PAGE_SIZE - 5) });
    render(<NotificationsPage />);
    await waitFor(() => expect(screen.getByText('Уведомление 0')).toBeTruthy());
    expect(screen.queryByText('Показать ещё')).toBeNull();
  });

  it('кнопка ЕСТЬ, когда пришло ровно PAGE_SIZE', async () => {
    getMock.mockResolvedValue({ data: mk(PAGE_SIZE) });
    render(<NotificationsPage />);
    await waitFor(() => expect(screen.getByText('Показать ещё')).toBeTruthy());
  });

  it('клик догружает следующую страницу и дедуплицирует', async () => {
    getMock
      .mockResolvedValueOnce({ data: mk(PAGE_SIZE, 0) })
      .mockResolvedValueOnce({ data: mk(PAGE_SIZE, PAGE_SIZE) });
    render(<NotificationsPage />);
    await waitFor(() => expect(screen.getByText('Показать ещё')).toBeTruthy());

    fireEvent.click(screen.getByText('Показать ещё'));

    await waitFor(() =>
      expect(getMock).toHaveBeenCalledWith('/notifications', {
        params: { page: 2, limit: PAGE_SIZE },
      }),
    );
    await waitFor(() => expect(screen.getByText('Уведомление 20')).toBeTruthy());
  });

  it('кнопка исчезает, если последняя страница пришла неполной', async () => {
    getMock
      .mockResolvedValueOnce({ data: mk(PAGE_SIZE, 0) })
      .mockResolvedValueOnce({ data: mk(4, PAGE_SIZE) });
    render(<NotificationsPage />);
    await waitFor(() => expect(screen.getByText('Показать ещё')).toBeTruthy());

    fireEvent.click(screen.getByText('Показать ещё'));

    await waitFor(() => expect(screen.queryByText('Показать ещё')).toBeNull());
  });
});