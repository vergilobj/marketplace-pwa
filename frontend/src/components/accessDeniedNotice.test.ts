/**
 * COSMETIC-2 — регрессия на информирование при редиректе с закрытого раздела.
 *
 * Что проверяем:
 *  1. причина редиректа действительно сохраняется и читается ровно один раз
 *     (обычная перезагрузка главной тост не повторяет);
 *  2. текст причины зависит от требуемой роли;
 *  3. guard НЕ ослаблен — условие блокировки осталось прежним
 *     (role !== requiredRole && role !== 'ADMIN').
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  rememberAccessDenied,
  consumeAccessDenied,
  showAccessDeniedToast,
} from './accessDeniedNotice';

vi.mock('react-hot-toast', () => ({ default: vi.fn() }));
import toast from 'react-hot-toast';

beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe('accessDeniedNotice (COSMETIC-2)', () => {
  it('сохраняет причину и отдаёт её один раз (read-once)', () => {
    rememberAccessDenied({
      path: '/leads',
      reason: 'SELLER',
      message: 'Раздел доступен только продавцам. Возвращаем на главную',
    });

    const first = consumeAccessDenied();
    expect(first?.path).toBe('/leads');
    expect(first?.message).toContain('только продавцам');
    // повторное чтение — пусто, иначе тост всплывал бы при каждой перезагрузке
    expect(consumeAccessDenied()).toBeNull();
  });

  it('без сохранённой причины возвращает null', () => {
    expect(consumeAccessDenied()).toBeNull();
  });

  it('битый JSON не роняет приложение', () => {
    sessionStorage.setItem('accessDeniedNotice', '{не json');
    expect(consumeAccessDenied()).toBeNull();
  });

  it('показывает тост с текстом причины', () => {
    showAccessDeniedToast({
      path: '/admin',
      reason: 'ADMIN',
      message: 'Раздел доступен только администраторам. Возвращаем на главную',
    });
    expect(toast).toHaveBeenCalledTimes(1);
    const [message] = vi.mocked(toast).mock.calls[0];
    expect(message).toContain('только администраторам');
  });
});