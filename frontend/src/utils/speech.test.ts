/**
 * Регрессия на движок диктовки (жалоба владельца 2026-09-15: «что-то пишет,
 * что-то не пишет, выбрасывает»).
 *
 * Что охраняем:
 *  1. все финальные результаты события собираются, а не только последний
 *     (раньше середина фразы молча терялась);
 *  2. onend перезапускает распознавание — без этого Android Chrome умирает
 *     после первой фразы (`continuous = true` там игнорируется);
 *  3. после ручного stop() перезапуска НЕТ и движок заглушен;
 *  4. `not-allowed` — не перезапускаем, отдаём onError;
 *  5. `no-speech` — не фатально: движок живёт, наружу идёт только notice;
 *  6. потолок автоперезапусков не даёт вечного цикла.
 *
 * Микрофон в headless не проверить — здесь мокается сам SpeechRecognition,
 * события эмулируются вручную.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  startContinuousDictation,
  isSpeechSupported,
  MAX_AUTO_RESTARTS,
  SPEECH_ERROR_MESSAGES,
  type SpeechErrorKind,
} from './speech';

type Alt = { transcript: string; confidence: number };
type Res = { isFinal: boolean; length: number; [index: number]: Alt };
type ResList = { length: number; [index: number]: Res };
type RecEvent = { results: ResList; resultIndex: number };
type ErrEvent = { error: string; message?: string };

/** Фейковый SpeechRecognition: события дёргаем руками, start() считаем. */
class FakeRecognition {
  static instances: FakeRecognition[] = [];

  lang = '';
  continuous = false;
  interimResults = false;
  onresult: ((event: RecEvent) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: ErrEvent) => void) | null = null;

  startCount = 0;
  stopCount = 0;
  abortCount = 0;

  constructor() {
    FakeRecognition.instances.push(this);
  }

  start(): void {
    this.startCount += 1;
  }

  stop(): void {
    this.stopCount += 1;
  }

  abort(): void {
    this.abortCount += 1;
  }

  emitResult(event: RecEvent): void {
    this.onresult?.(event);
  }

  emitError(error: string): void {
    this.onerror?.({ error, message: '' });
  }

  emitEnd(): void {
    this.onend?.();
  }
}

/** Собирает event.results структурно так же, как это делает браузер. */
function makeResultEvent(
  items: { transcript: string; isFinal: boolean }[],
  resultIndex = 0,
): RecEvent {
  const results = items.map((item) => {
    const res: Res = {
      isFinal: item.isFinal,
      length: 1,
      0: { transcript: item.transcript, confidence: 1 },
    };
    return res;
  });
  return { results: results as unknown as ResList, resultIndex };
}

function installCtor(): void {
  (window as unknown as Record<string, unknown>).SpeechRecognition =
    FakeRecognition;
}

function uninstallCtor(): void {
  const w = window as unknown as Record<string, unknown>;
  delete w.SpeechRecognition;
  delete w.webkitSpeechRecognition;
}

function lastRec(): FakeRecognition {
  const rec = FakeRecognition.instances[FakeRecognition.instances.length - 1];
  if (!rec) throw new Error('SpeechRecognition не был создан');
  return rec;
}

/** Пауза автоперезапуска в движке. */
const RESTART_DELAY_MS = 250;

beforeEach(() => {
  FakeRecognition.instances = [];
  vi.useFakeTimers();
  installCtor();
});

afterEach(() => {
  vi.useRealTimers();
  uninstallCtor();
});

describe('speech.ts — поддержка браузера', () => {
  it('isSpeechSupported() = true, когда конструктор есть', () => {
    expect(isSpeechSupported()).toBe(true);
  });

  it('isSpeechSupported() = false без конструктора', () => {
    uninstallCtor();
    expect(isSpeechSupported()).toBe(false);
  });

  it('без поддержки движок сразу отдаёт onEnd и не падает', () => {
    uninstallCtor();
    const onEnd = vi.fn();
    const stop = startContinuousDictation({ onFinal: vi.fn(), onEnd });
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(() => stop()).not.toThrow();
    expect(FakeRecognition.instances).toHaveLength(0);
  });
});

describe('speech.ts — настройки сессии', () => {
  it('continuous и interimResults включены', () => {
    startContinuousDictation({ onFinal: vi.fn() });
    const rec = lastRec();
    expect(rec.continuous).toBe(true);
    expect(rec.interimResults).toBe(true);
    expect(rec.lang).toBe('ru-RU');
    expect(rec.startCount).toBe(1);
  });
});

describe('speech.ts — сбор результатов', () => {
  it('собирает ВСЕ финальные результаты события, а не только последний', () => {
    const onFinal = vi.fn();
    startContinuousDictation({ onFinal });
    const rec = lastRec();

    rec.emitResult(
      makeResultEvent([
        { transcript: 'нужно ', isFinal: true },
        { transcript: 'записать ', isFinal: true },
        { transcript: 'всё', isFinal: true },
      ]),
    );

    expect(onFinal).toHaveBeenCalledTimes(1);
    expect(onFinal).toHaveBeenCalledWith('нужно записать всё');
  });

  it('учитывает resultIndex: уже отданное не дублируется', () => {
    const onFinal = vi.fn();
    startContinuousDictation({ onFinal });
    const rec = lastRec();

    rec.emitResult(
      makeResultEvent(
        [
          { transcript: 'первое ', isFinal: true },
          { transcript: 'второе', isFinal: true },
        ],
        1,
      ),
    );

    expect(onFinal).toHaveBeenCalledWith('второе');
  });

  it('неподтверждённый текст уходит в onInterim, а не в onFinal', () => {
    const onFinal = vi.fn();
    const onInterim = vi.fn();
    startContinuousDictation({ onFinal, onInterim });
    const rec = lastRec();

    rec.emitResult(
      makeResultEvent([{ transcript: 'живой текст', isFinal: false }]),
    );

    expect(onFinal).not.toHaveBeenCalled();
    expect(onInterim).toHaveBeenCalledWith('живой текст');
  });

  it('пустая речь не дёргает onFinal', () => {
    const onFinal = vi.fn();
    startContinuousDictation({ onFinal });
    const rec = lastRec();

    rec.emitResult(makeResultEvent([{ transcript: '   ', isFinal: true }]));

    expect(onFinal).not.toHaveBeenCalled();
  });
});

describe('speech.ts — авто-рестарт в onend', () => {
  it('перезапускает распознавание, если ручной остановки не было', () => {
    const onStatus = vi.fn();
    startContinuousDictation({ onFinal: vi.fn(), onStatus });
    const rec = lastRec();
    expect(rec.startCount).toBe(1);

    rec.emitEnd();
    // Мгновенный start() в onend браузер отбивает — движок ждёт паузу.
    expect(rec.startCount).toBe(1);
    expect(onStatus).toHaveBeenLastCalledWith('restarting');

    vi.advanceTimersByTime(RESTART_DELAY_MS);

    expect(rec.startCount).toBe(2);
    expect(onStatus).toHaveBeenLastCalledWith('listening');
  });

  it('перезапускается многократно — сессия живёт после каждой фразы', () => {
    startContinuousDictation({ onFinal: vi.fn() });
    const rec = lastRec();

    for (let i = 0; i < 3; i++) {
      rec.emitEnd();
      vi.advanceTimersByTime(RESTART_DELAY_MS);
    }

    expect(rec.startCount).toBe(4);
  });

  it('потолок автоперезапусков останавливает вечный цикл', () => {
    const onError = vi.fn();
    const onEnd = vi.fn();
    startContinuousDictation({ onFinal: vi.fn(), onError, onEnd });
    const rec = lastRec();

    for (let i = 0; i < MAX_AUTO_RESTARTS + 5; i++) {
      rec.emitEnd();
      vi.advanceTimersByTime(RESTART_DELAY_MS);
    }

    // 1 старт изначально + MAX_AUTO_RESTARTS перезапусков, дальше — стоп.
    expect(rec.startCount).toBe(1 + MAX_AUTO_RESTARTS);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});

describe('speech.ts — ручная остановка', () => {
  it('после stop() перезапуска НЕ происходит, движок заглушен', () => {
    const onEnd = vi.fn();
    const stop = startContinuousDictation({ onFinal: vi.fn(), onEnd });
    const rec = lastRec();

    stop();

    expect(rec.stopCount).toBe(1);
    expect(rec.abortCount).toBe(1);
    expect(onEnd).toHaveBeenCalledTimes(1);

    rec.emitEnd();
    vi.advanceTimersByTime(RESTART_DELAY_MS * 10);

    expect(rec.startCount).toBe(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('повторный stop() безопасен', () => {
    const onEnd = vi.fn();
    const stop = startContinuousDictation({ onFinal: vi.fn(), onEnd });
    stop();
    stop();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('stop() отменяет уже запланированный перезапуск', () => {
    const stop = startContinuousDictation({ onFinal: vi.fn() });
    const rec = lastRec();

    rec.emitEnd();
    stop();
    vi.advanceTimersByTime(RESTART_DELAY_MS * 10);

    expect(rec.startCount).toBe(1);
  });
});

describe('speech.ts — ошибки', () => {
  it('not-allowed: перезапуска НЕТ, вызван onError', () => {
    const onError = vi.fn();
    const onEnd = vi.fn();
    startContinuousDictation({ onFinal: vi.fn(), onError, onEnd });
    const rec = lastRec();

    rec.emitError('not-allowed');
    rec.emitEnd();
    vi.advanceTimersByTime(RESTART_DELAY_MS * 10);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBe<SpeechErrorKind>('not-allowed');
    expect(onError.mock.calls[0][1]).toBe(SPEECH_ERROR_MESSAGES['not-allowed']);
    expect(rec.startCount).toBe(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('service-not-allowed: перезапуска НЕТ, вызван onError', () => {
    const onError = vi.fn();
    startContinuousDictation({ onFinal: vi.fn(), onError });
    const rec = lastRec();

    rec.emitError('service-not-allowed');
    rec.emitEnd();
    vi.advanceTimersByTime(RESTART_DELAY_MS * 10);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBe('service-not-allowed');
    expect(rec.startCount).toBe(1);
  });

  it('audio-capture: фатально, перезапуска НЕТ', () => {
    const onError = vi.fn();
    startContinuousDictation({ onFinal: vi.fn(), onError });
    const rec = lastRec();

    rec.emitError('audio-capture');
    rec.emitEnd();
    vi.advanceTimersByTime(RESTART_DELAY_MS * 10);

    expect(onError.mock.calls[0][0]).toBe('audio-capture');
    expect(rec.startCount).toBe(1);
  });

  it('no-speech НЕ фатален: движок живёт, наружу идёт только notice', () => {
    const onError = vi.fn();
    const onNotice = vi.fn();
    startContinuousDictation({ onFinal: vi.fn(), onError, onNotice });
    const rec = lastRec();

    rec.emitError('no-speech');

    expect(onError).not.toHaveBeenCalled();
    expect(onNotice).toHaveBeenCalledTimes(1);
    expect(onNotice.mock.calls[0][0]).toBe<SpeechErrorKind>('no-speech');

    // Штатное завершение после тишины поднимает сессию заново.
    rec.emitEnd();
    vi.advanceTimersByTime(RESTART_DELAY_MS);
    expect(rec.startCount).toBe(2);
  });

  it('network: notice без остановки сессии', () => {
    const onError = vi.fn();
    const onNotice = vi.fn();
    startContinuousDictation({ onFinal: vi.fn(), onError, onNotice });
    const rec = lastRec();

    rec.emitError('network');

    expect(onError).not.toHaveBeenCalled();
    expect(onNotice.mock.calls[0][0]).toBe('network');
  });

  it('неизвестный код ошибки не роняет движок', () => {
    const onNotice = vi.fn();
    startContinuousDictation({ onFinal: vi.fn(), onNotice });
    const rec = lastRec();

    rec.emitError('что-то-новое');

    expect(onNotice.mock.calls[0][0]).toBe('unknown');
    expect(rec.startCount).toBe(1);
  });
});

describe('speech.ts — обратная совместимость', () => {
  it('старая позиционная сигнатура (onResult, onEnd, onError) работает', () => {
    const onResult = vi.fn();
    const onEnd = vi.fn();
    const onError = vi.fn();
    const stop = startContinuousDictation(onResult, onEnd, onError);
    const rec = lastRec();

    rec.emitResult(makeResultEvent([{ transcript: 'текст', isFinal: true }]));
    expect(onResult).toHaveBeenCalledWith('текст');

    rec.emitError('not-allowed');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBe('not-allowed');

    stop();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('сбой start() не оставляет висящую сессию', () => {
    const onEnd = vi.fn();
    const Original = FakeRecognition;
    class ThrowingRecognition extends Original {
      start(): void {
        super.start();
        throw new Error('already started');
      }
    }
    (window as unknown as Record<string, unknown>).SpeechRecognition =
      ThrowingRecognition;

    startContinuousDictation({ onFinal: vi.fn(), onEnd });

    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});