import { parseBazarContent } from './bazar-response.parser';

/**
 * B2: устойчивый парсер ```refs / ```action.
 * Покрывает формы, на которых ломался старый строгий `parseContent`:
 * незакрытый фенс, голый маркер, пустая строка после маркера, битый JSON.
 */
describe('parseBazarContent', () => {
  it('закрытый фенс с валидным JSON → вырезан, refs/action разобраны', () => {
    const raw =
      'Вот товары\n```refs\n[{"type":"PRODUCT","id":"p1","title":"Стол"}]\n```\n' +
      '```action\n{"intent":"none"}\n```';
    const r = parseBazarContent(raw);
    expect(r.text).toBe('Вот товары');
    expect(r.refs).toEqual([{ type: 'PRODUCT', id: 'p1', title: 'Стол' }]);
    expect(r.action).toEqual({ intent: 'none' });
  });

  it('закрытый фенс с битым JSON → блок вырезан, refs пустые', () => {
    const raw = 'Текст\n```refs\n[{broken json\n```\nконец';
    const r = parseBazarContent(raw);
    expect(r.text).not.toContain('broken');
    expect(r.text).not.toContain('refs');
    expect(r.text).not.toContain('```');
    expect(r.refs ?? []).toEqual([]);
    expect(r.text).toContain('Текст');
    expect(r.text).toContain('конец');
  });

  it('незакрытый фенс → вырезан до конца текста', () => {
    const raw = 'Ответ\n```refs\n[{"type":"POST","id":"x"}]';
    const r = parseBazarContent(raw);
    expect(r.text).toBe('Ответ');
    expect(r.refs).toEqual([{ type: 'POST', id: 'x' }]);
  });

  it('голый маркер + JSON → вырезан, хвост текста сохранён', () => {
    const raw = 'Смотри\nrefs\n[{"type":"PRODUCT","id":"p9"}]\n\nвсё';
    const r = parseBazarContent(raw);
    expect(r.text).not.toContain('p9');
    expect(r.refs).toEqual([{ type: 'PRODUCT', id: 'p9' }]);
    expect(r.text).toContain('Смотри');
    expect(r.text).toContain('всё');
  });

  it('голый маркер без JSON (слово «refs» в прозе) → НЕ вырезан', () => {
    const raw = 'Вот список refs\nэто просто текст про refs\nникакого json';
    const r = parseBazarContent(raw);
    expect(r.text).toContain('refs');
    expect(r.text).toContain('никакого json');
    expect(r.refs ?? []).toEqual([]);
  });

  it('пустая строка после маркера → блок всё равно разобран', () => {
    const raw = 'Есть\n```refs\n\n[{"type":"USER","id":"u1"}]\n```';
    const r = parseBazarContent(raw);
    expect(r.text).toBe('Есть');
    expect(r.refs).toEqual([{ type: 'USER', id: 'u1' }]);
  });

  it('чистый текст → не тронут', () => {
    const raw = 'Привет! Чем помочь? Ищу стол и стул, есть варианты.';
    const r = parseBazarContent(raw);
    expect(r.text).toBe(raw);
    expect(r.refs ?? []).toEqual([]);
    expect(r.action).toBeUndefined();
  });

  it('несколько блоков → оба разобраны, служебный мусор вырезан', () => {
    const raw =
      'Нашёл\n```refs\n[{"type":"PRODUCT","id":"a"}]\n```\nи ещё\n' +
      '```action\n{"intent":"open_deal","payload":{"dealId":"d1"}}\n```\nГотово';
    const r = parseBazarContent(raw);
    expect(r.refs).toEqual([{ type: 'PRODUCT', id: 'a' }]);
    expect(r.action).toEqual({ intent: 'open_deal', payload: { dealId: 'd1' } });
    expect(r.text).not.toContain('```');
    expect(r.text).toContain('Нашёл');
    expect(r.text).toContain('Готово');
  });

  it('битый action → блок вырезан, action не отдан', () => {
    const raw = 'Ок\n```action\n{not valid}\n```';
    const r = parseBazarContent(raw);
    expect(r.text).toBe('Ок');
    expect(r.action).toBeUndefined();
  });
});