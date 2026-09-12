import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdminPage from './AdminPage';
import api from '../api/axios';

/**
 * N1: 5 «денежных» настроек платформы должны быть доступны в админке.
 *
 * До правки массив полей в `renderSettings()` содержал 4 записи, а
 * `deposit_tolerance_percent`, `order_payment_ttl_minutes`,
 * `escrow_ship_deadline_days`, `escrow_autocomplete_days`,
 * `withdrawal_min_amount` менялись только прямым SQL.
 */

vi.mock('../api/axios', () => ({
  default: { get: vi.fn(), put: vi.fn(), patch: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

vi.mock('../api/invites', () => ({
  getInvites: vi.fn(),
  createInvite: vi.fn(),
  deleteInvite: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const mockedApi = vi.mocked(api);

const SETTINGS_RESPONSE: Record<string, string> = {
  platform_fee_percent: '10',
  referral_percent: '5',
  ad_price: '5000',
  stop_words: 'спам',
  deposit_tolerance_percent: '1',
  order_payment_ttl_minutes: '15',
  escrow_ship_deadline_days: '5',
  escrow_autocomplete_days: '7',
  withdrawal_min_amount: '0',
};

const N1_LABELS = [
  'Допуск недоплаты (%)',
  'Срок оплаты заказа (мин)',
  'Срок отправки продавцом (дней)',
  'Авто-завершение заказа (дней)',
  'Минимальная сумма вывода (USDT)',
];

/** Открывает админку и переключает на вкладку «Настройки». */
const openSettingsTab = async () => {
  render(
    <MemoryRouter initialEntries={['/admin']}>
      <AdminPage />
    </MemoryRouter>,
  );
  const tab = await screen.findByRole('button', { name: /^Настройки$/ });
  fireEvent.click(tab);
  await screen.findByText('Комиссия платформы (%)');
};

/** input внутри строки с данным label. */
const inputByLabel = (label: string): HTMLInputElement => {
  const el = screen.getByText(label);
  const row = el.parentElement as HTMLElement;
  const input = row.querySelector('input');
  if (!input) throw new Error(`input не найден для «${label}»`);
  return input as HTMLInputElement;
};

/** Кнопка «Сохранить» внутри строки с данным label. */
const buttonByLabel = (label: string): HTMLButtonElement => {
  const el = screen.getByText(label);
  const row = el.parentElement as HTMLElement;
  const button = row.querySelector('button');
  if (!button) throw new Error(`button не найден для «${label}»`);
  return button as HTMLButtonElement;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedApi.get.mockImplementation(async (url: string) => {
    if (url === '/settings') return { data: SETTINGS_RESPONSE } as never;
    if (url === '/admin/dashboard') {
      return {
        data: { usersCount: 0, productsCount: 0, ordersCount: 0, totalRevenue: 0 },
      } as never;
    }
    return { data: { items: [], pages: 1 } } as never;
  });
});

describe('AdminPage — настройки (N1)', () => {
  it.each(N1_LABELS)('показывает поле «%s»', async (label) => {
    await openSettingsTab();
    expect(screen.getByText(label)).toBeTruthy();
  });

  it('подтягивает текущие значения новых полей из GET /settings', async () => {
    await openSettingsTab();

    await waitFor(() =>
      expect(inputByLabel('Допуск недоплаты (%)').value).toBe('1'),
    );
    expect(inputByLabel('Срок оплаты заказа (мин)').value).toBe('15');
    expect(inputByLabel('Срок отправки продавцом (дней)').value).toBe('5');
    expect(inputByLabel('Авто-завершение заказа (дней)').value).toBe('7');
    expect(inputByLabel('Минимальная сумма вывода (USDT)').value).toBe('0');
  });

  it('подтягивает значения старых полей (регрессия)', async () => {
    await openSettingsTab();

    await waitFor(() =>
      expect(inputByLabel('Комиссия платформы (%)').value).toBe('10'),
    );
    expect(inputByLabel('Цена рекламы (USDT/день)').value).toBe('5000');
  });

  it('сохранение нового поля уходит в PUT /settings с правильным ключом', async () => {
    const toast = (await import('react-hot-toast')).default;
    mockedApi.put.mockResolvedValue({ data: {} } as never);

    await openSettingsTab();

    fireEvent.change(inputByLabel('Минимальная сумма вывода (USDT)'), {
      target: { value: '100' },
    });
    fireEvent.click(buttonByLabel('Минимальная сумма вывода (USDT)'));

    await waitFor(() =>
      expect(mockedApi.put).toHaveBeenCalledWith('/settings', {
        key: 'withdrawal_min_amount',
        value: '100',
      }),
    );
    expect(toast.success).toHaveBeenCalled();
  });

  it('сохранение order_payment_ttl_minutes уходит с ключом order_payment_ttl_minutes', async () => {
    mockedApi.put.mockResolvedValue({ data: {} } as never);

    await openSettingsTab();

    fireEvent.change(inputByLabel('Срок оплаты заказа (мин)'), {
      target: { value: '1' },
    });
    fireEvent.click(buttonByLabel('Срок оплаты заказа (мин)'));

    await waitFor(() =>
      expect(mockedApi.put).toHaveBeenCalledWith('/settings', {
        key: 'order_payment_ttl_minutes',
        value: '1',
      }),
    );
  });

  it('полный список полей настроек — 9 записей (4 старых + 5 новых)', async () => {
    await openSettingsTab();

    const labels = [
      'Комиссия платформы (%)',
      'Реферальный процент (%)',
      'Цена рекламы (USDT/день)',
      ...N1_LABELS,
      'Стоп-слова (через запятую)',
    ];
    expect(labels).toHaveLength(9);
    for (const l of labels) {
      expect(screen.getByText(l)).toBeTruthy();
    }
  });
});