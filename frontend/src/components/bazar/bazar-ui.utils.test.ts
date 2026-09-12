import { describe, expect, it } from 'vitest';
import { parseBazarResponse } from './bazar-ui.utils';

/**
 * Разбор ответа Базара: служебные блоки ```refs / ```action не должны
 * попадать в текст пузыря (FIX A1, проблема 1).
 */
describe('parseBazarResponse', () => {
  it('вырезает закрытые блоки refs и action', () => {
    const raw = [
      'Пиши, что надо — хоть конкретную вещь, хоть «подбери что-нибудь». Разберёмся.',
      '',
      '```refs',
      '[{"type":"PRODUCT","id":"p1","title":"Куртка","price":3500}]',
      '```',
      '',
      '```action',
      '{"intent":"none","payload":{}}',
      '```',
    ].join('\n');

    const { cleanText, refs, action } = parseBazarResponse(raw);

    expect(cleanText).toBe(
      'Пиши, что надо — хоть конкретную вещь, хоть «подбери что-нибудь». Разберёмся.',
    );
    expect(cleanText).not.toContain('refs');
    expect(cleanText).not.toContain('action');
    expect(cleanText).not.toContain('{');
    expect(cleanText).not.toContain('}');
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ type: 'PRODUCT', id: 'p1', price: 3500 });
    expect(action).toEqual({ intent: 'none', payload: {} });
  });

  it('вырезает голые маркеры без фенсов (как на скриншоте владельца)', () => {
    const raw = [
      'Разберёмся.',
      '',
      'refs',
      '[]',
      '',
      'action',
      '{"intent":"none","payload":{}}',
    ].join('\n');

    const { cleanText, refs, action } = parseBazarResponse(raw);

    expect(cleanText).toBe('Разберёмся.');
    expect(refs).toEqual([]);
    expect(action).toEqual({ intent: 'none', payload: {} });
  });

  it('вырезает незакрытый фенс до конца текста', () => {
    const raw = [
      'Вот что нашёл.',
      '',
      '```action',
      '{"intent":"create_deal","payload":{"dealId":"d1"}}',
    ].join('\n');

    const { cleanText, action } = parseBazarResponse(raw);

    expect(cleanText).toBe('Вот что нашёл.');
    expect(action).toEqual({ intent: 'create_deal', payload: { dealId: 'd1' } });
  });

  it('распознаёт блок с пустой строкой после маркера', () => {
    const raw = ['Держи.', '', '```refs', '', '[{"type":"POST","id":"post1"}]', '```'].join('\n');

    const { cleanText, refs } = parseBazarResponse(raw);

    expect(cleanText).toBe('Держи.');
    expect(refs).toEqual([{ type: 'POST', id: 'post1' }]);
  });

  it('обычный текст без блоков не трогает', () => {
    const raw = 'Есть куртки от 3 500 USDT.\nЧто интересует?';
    const { cleanText, refs, action } = parseBazarResponse(raw);

    expect(cleanText).toBe(raw);
    expect(refs).toEqual([]);
    expect(action).toBeNull();
  });

  it('битый JSON в фенсе вырезается, текст остаётся', () => {
    const raw = ['Ответ.', '', '```refs', '[{broken', '```'].join('\n');
    const { cleanText, refs } = parseBazarResponse(raw);

    // Фенс — явное намерение отдать служебный блок: вырезаем всегда,
    // но реплику не теряем и битые refs в карточки не превращаем.
    expect(cleanText).toBe('Ответ.');
    expect(cleanText).not.toContain('```');
    expect(cleanText).not.toContain('{');
    expect(refs).toEqual([]);
  });

  it('незакрытый фенс с битым JSON тоже вырезается', () => {
    const raw = ['Ответ.', '', '```action', '{broken'].join('\n');
    const { cleanText, action } = parseBazarResponse(raw);

    expect(cleanText).toBe('Ответ.');
    expect(action).toBeNull();
  });

  it('проза со словом action в строке не вырезается (без фенса и без JSON)', () => {
    const raw = ['Напиши так:', '', 'action', 'потом подтверди'].join('\n');
    const { cleanText } = parseBazarResponse(raw);

    // Тело не JSON → это не служебный блок, текст оставляем как есть.
    expect(cleanText).toContain('action');
    expect(cleanText).toContain('потом подтверди');
  });

  it('переживает null/undefined', () => {
    expect(parseBazarResponse(null).cleanText).toBe('');
    expect(parseBazarResponse(undefined).cleanText).toBe('');
  });
});