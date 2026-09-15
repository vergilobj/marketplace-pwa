import { describe, it, expect } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import {
  TOO_MANY_REQUESTS_MESSAGE,
  errorMessage,
  errorStatus,
  humanizeBackendMessage,
} from './error';

/**
 * B1: сырые тексты class-validator не должны доходить до пользователя.
 *
 * Прецедент: форма товара показывала
 * «description must be shorter than or equal to 2000 characters» как есть.
 */

function axiosErrorWith(status: number | null, message?: unknown): AxiosError {
  const headers = new AxiosHeaders();
  const err = new AxiosError(
    'Request failed',
    undefined,
    { headers } as never,
    status === null ? {} : undefined,
    status === null
      ? undefined
      : { status, statusText: '', headers, config: { headers } as never, data: message === undefined ? {} : { message } },
  );
  // isAxiosError проверяется по флагу, а не по instanceof — выставляем явно.
  err.isAxiosError = true;
  return err;
}

describe('humanizeBackendMessage — таблица переводов class-validator', () => {
  it('«must be shorter than or equal to N characters» → максимум N символов', () => {
    expect(
      humanizeBackendMessage('description must be shorter than or equal to 2000 characters'),
    ).toBe('Слишком длинно: максимум 2000 символов');
    expect(humanizeBackendMessage('title must be shorter than or equal to 200 characters')).toBe(
      'Слишком длинно: максимум 200 символов',
    );
  });

  it('«must be longer than or equal to N characters» → минимум N символов', () => {
    expect(humanizeBackendMessage('password must be longer than or equal to 6 characters')).toBe(
      'Слишком коротко: минимум 6 символов',
    );
  });

  it('«should not be empty» → Заполни это поле', () => {
    expect(humanizeBackendMessage('title should not be empty')).toBe('Заполни это поле');
  });

  it('«must be a string» → Ожидается текст', () => {
    expect(humanizeBackendMessage('content must be a string')).toBe('Ожидается текст');
  });

  it('«must be an integer number» / «must be a number» → Ожидается число', () => {
    expect(humanizeBackendMessage('days must be an integer number')).toBe('Ожидается целое число');
    expect(humanizeBackendMessage('price must be a number conforming to the specified constraints')).toBe(
      'Ожидается число',
    );
  });

  it('«must be one of: A, B, C» → перечисление разрешённых значений', () => {
    expect(humanizeBackendMessage('type must be one of: SUGGESTION, BUG, OTHER')).toBe(
      'Недопустимое значение. Разрешено: SUGGESTION, BUG, OTHER',
    );
  });

  it('«must be a boolean value» → Ожидается да/нет', () => {
    expect(humanizeBackendMessage('isAd must be a boolean value')).toBe('Ожидается да/нет');
  });

  it('регистронезависимо (класс-validator умеет и с большой буквы)', () => {
    expect(humanizeBackendMessage('Description must be shorter than or equal to 2000 characters')).toBe(
      'Слишком длинно: максимум 2000 символов',
    );
  });

  it('неизвестный текст не ломается и возвращается как есть', () => {
    expect(humanizeBackendMessage('link must be a URL address')).toBe('link must be a URL address');
    expect(humanizeBackendMessage('Что-то пошло не так')).toBe('Что-то пошло не так');
  });

  it('пустая строка не ломается', () => {
    expect(humanizeBackendMessage('')).toBe('');
    expect(humanizeBackendMessage('   ')).toBe('');
  });
});

describe('errorMessage — сквозной путь', () => {
  it('переводит массив сообщений DTO (class-validator)', () => {
    const err = axiosErrorWith(400, [
      'description must be shorter than or equal to 2000 characters',
      'price must be a number',
    ]);
    expect(errorMessage(err, 'Ошибка')).toBe('Слишком длинно: максимум 2000 символов');
  });

  it('переводит одиночную строку message', () => {
    const err = axiosErrorWith(400, 'title should not be empty');
    expect(errorMessage(err, 'Ошибка')).toBe('Заполни это поле');
  });

  it('429 не сломан — текст бэкенда не подставляется', () => {
    const err = axiosErrorWith(429, 'ThrottlerException: Too Many Requests');
    expect(errorMessage(err, 'Ошибка')).toBe(TOO_MANY_REQUESTS_MESSAGE);
  });

  it('5xx не сломан', () => {
    const err = axiosErrorWith(500, 'InternalServerError: something');
    expect(errorMessage(err, 'Ошибка')).toBe('Сервер прилёг. Попробуй ещё раз через минуту');
  });

  it('сетевой сбой (нет ответа) не сломан', () => {
    const err = axiosErrorWith(null);
    expect(errorMessage(err, 'Ошибка')).toBe(
      'Нет связи с сервером. Проверь интернет и попробуй снова',
    );
    expect(errorStatus(err)).toBe(0);
  });

  it('обычный Error отдаётся как есть, фолбэк — при пустом', () => {
    expect(errorMessage(new Error('что-то'), 'Фолбэк')).toBe('что-то');
    expect(errorMessage('строка', 'Фолбэк')).toBe('Фолбэк');
    expect(errorMessage(undefined, 'Фолбэк')).toBe('Фолбэк');
  });
});