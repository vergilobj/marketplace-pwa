/**
 * B2-регресс: phoneRe ловит ТЕЛЕФОННЫЕ форматы и НЕ ловит длинные числа
 * (артикулы, серийники, «1 234 567 890»).
 *
 * Живой воспроизведённый баг: BUYER, POST /posts с «Артикул 1234567890,
 * доставка 5 дней» → 400 «передавать телефон напрямую нельзя».
 *
 * Проверяем через публичный moderate() БЕЗ userId — иначе ADMIN/MODERATOR
 * обход (isTrustedRole) даст ложный allow.
 */
import { ConfigService } from '@nestjs/config';
import { ModerationService } from './moderation.service';

describe('ModerationService — phoneRe (B2)', () => {
  let service: ModerationService;

  beforeEach(() => {
    // LLM-слой недоступен → детерминированный fallback allow.
    // regExp-слой отрабатывает ДО него, поэтому вердикт по телефону стабилен.
    (global as any).fetch = jest.fn(() =>
      Promise.reject(new Error('LLM disabled in unit test')),
    );

    const config = {
      get: jest.fn(() => undefined),
    } as unknown as ConfigService;

    // prisma не используется без userId — достаточно заглушки.
    const prisma = {} as any;

    service = new ModerationService(config, prisma);
  });

  afterAll(() => {
    delete (global as any).fetch;
  });

  // ---------------------------------------------------------------- allow
  it.each([
    ['Артикул 1234567890, доставка 5 дней'],
    ['Вес 1 234 567 890 грамм суммарно'],
    ['Серийный номер 861234567890123 корпуса'],
    ['Артикул 1234567890'],
    ['1234567890'],
    ['861234567890123'],
    ['1 234 567 890'],
  ])('не блокирует длинное число: %s', async (text) => {
    const verdict = await service.moderate({ text, entityType: 'post' });
    expect(verdict.violations).not.toContain('phone');
    expect(verdict.verdict).toBe('allow');
  });

  // ---------------------------------------------------------------- block
  it.each([
    ['Звони 8 (912) 345-67-89'],
    ['8 (912) 345-67-89'],
    ['+7 912 345 67 89'],
    ['89123456789'],
    ['+79123456789'],
    ['8-912-345-67-89'],
    ['+7 (912) 345-67-89'],
  ])('блокирует телефон: %s', async (text) => {
    const verdict = await service.moderate({ text, entityType: 'post' });
    expect(verdict.violations).toContain('phone');
    expect(verdict.verdict).toBe('block');
  });

  // ------------------------------------------------- не сломали эвфемизмы
  it('блокирует эвфемизм «мой вацап» как off_platform', async () => {
    const verdict = await service.moderate({
      text: 'мой вацап',
      entityType: 'post',
    });
    expect(verdict.violations).toContain('off_platform');
    expect(verdict.verdict).toBe('block');
  });

  it('блокирует «созвонимся» как off_platform', async () => {
    const verdict = await service.moderate({
      text: 'давай созвонимся завтра',
      entityType: 'post',
    });
    expect(verdict.violations).toContain('off_platform');
    expect(verdict.verdict).toBe('block');
  });

  // --------------------------------------------------- телефон не порезал email
  it('email-регексп не тронут: ловит email', async () => {
    const verdict = await service.moderate({
      text: 'пиши на test@example.com',
      entityType: 'post',
    });
    expect(verdict.violations).toContain('email');
  });

  it('чистый текст проходит (allow)', async () => {
    const verdict = await service.moderate({
      text: 'Продаю велосипед, состояние хорошее, самовывоз',
      entityType: 'post',
    });
    expect(verdict.verdict).toBe('allow');
    expect(verdict.violations).toHaveLength(0);
  });
});