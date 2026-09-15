import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isSpeechSupported,
  startContinuousDictation,
  startAudioMeter,
} from '../utils/speech';

/**
 * Голосовой ввод — единая связка `startContinuousDictation` + `startAudioMeter`
 * для всех точек входа в приложении (Базар, поиск на главной, описание товара,
 * чат консультанта).
 *
 * Отдаёт наружу:
 *  - состояние `idle | listening | recorded`;
 *  - живой уровень громкости `level` (0..1) — его рисует DictationBars;
 *  - накопленный черновик `draft` (склейка всех финальных фрагментов);
 *  - действия `start / stop / cancel / commit`.
 *
 * Семантику результата задаёт вызывающая сторона:
 *  - `onFinal` — каждый финальный фрагмент сразу (поиск, описание товара,
 *    консультант: текст идёт в поле по мере распознавания);
 *  - `onCommit` — накопленный черновик по кнопке «отправить» (Базар).
 *
 * ⚠️ При размонтировании глушим И диктовку, И аудио-метр: иначе микрофон
 * остаётся висеть (реальный баг, уже фиксился).
 */

export type VoiceInputState = 'idle' | 'listening' | 'recorded';

export interface UseVoiceInputOptions {
  /** Каждый ФИНАЛЬНЫЙ фрагмент речи — семантику (замена/дополнение) задаёт вызывающая сторона. */
  onFinal?: (text: string) => void;
  /** Отдать накопленный черновик (кнопка «отправить»). */
  onCommit?: (text: string) => void | Promise<void>;
  /** Пользователь отменил ввод — вызывающая сторона откатывает свой ввод. */
  onCancel?: () => void;
  /** Фатальная ошибка распознавания — текст готов для toast. */
  onError?: (message: string) => void;
  /** Нефатальная помеха (тишина, сеть) — движок продолжает слушать. */
  onNotice?: (message: string) => void;
  /** Сессия диктовки окончательно завершена. */
  onEnd?: () => void;
}

export interface VoiceInput {
  state: VoiceInputState;
  /** Движок перезапускается (Android Chrome) — индикатор живости. */
  restarting: boolean;
  /** Уровень громкости 0..1. */
  level: number;
  /** Накопленный черновик распознанного текста. */
  draft: string;
  start: () => void;
  /** Остановить запись, сохранив черновик (состояние `recorded`). */
  stop: () => void;
  /** Остановить запись и обнулить черновик. */
  cancel: () => void;
  /** Остановить запись и отдать черновик в `onCommit` (или в переданный колбэк). */
  commit: (onCommit?: (text: string) => void | Promise<void>) => Promise<void>;
}

export function useVoiceInput(options: UseVoiceInputOptions = {}): VoiceInput {
  const [state, setState] = useState<VoiceInputState>('idle');
  const [restarting, setRestarting] = useState(false);
  const [level, setLevel] = useState(0);
  const [draft, setDraft] = useState('');

  const draftRef = useRef('');
  const stopDictationRef = useRef<(() => void) | null>(null);
  const stopAudioMeterRef = useRef<(() => void) | null>(null);

  /**
   * Актуальные колбэки — в ref. Запись в ref во время рендера запрещена
   * (react-hooks/refs), поэтому синхронизируем после коммита, в эффекте.
   */
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  /** Глушим движок и аудио-метр (без setState — можно звать из cleanup). */
  const stopEngines = useCallback(() => {
    stopDictationRef.current?.();
    stopAudioMeterRef.current?.();
    stopDictationRef.current = null;
    stopAudioMeterRef.current = null;
  }, []);

  // Останавливаем распознавание и аудио-метр при размонтировании.
  useEffect(() => stopEngines, [stopEngines]);

  const start = useCallback(() => {
    if (!isSpeechSupported()) return;

    // На всякий случай гасим предыдущую сессию: двойной `start()` оставил бы
    // висеть старый движок и старый поток микрофона.
    stopEngines();

    draftRef.current = '';
    setDraft('');
    setLevel(0);
    setRestarting(false);
    setState('listening');

    stopDictationRef.current = startContinuousDictation({
      // Каждый финальный фрагмент дополняет черновик и сразу уходит наружу.
      onFinal: (text) => {
        const next = draftRef.current ? `${draftRef.current} ${text}` : text;
        draftRef.current = next;
        setDraft(next);
        optionsRef.current.onFinal?.(text);
      },
      onStatus: (status) => setRestarting(status === 'restarting'),
      // Фатальная ошибка: сессия закончилась — показываем состояние и текст.
      onError: (_kind, message) => {
        optionsRef.current.onError?.(message);
        setRestarting(false);
        setState(draftRef.current.trim() ? 'recorded' : 'idle');
      },
      // Помеха (тишина, сеть) — движок продолжает слушать, но юзер должен знать.
      onNotice: (_kind, message) => optionsRef.current.onNotice?.(message),
      onEnd: () => {
        setRestarting(false);
        setState(draftRef.current.trim() ? 'recorded' : 'idle');
        optionsRef.current.onEnd?.();
      },
    });

    stopAudioMeterRef.current = startAudioMeter(setLevel);
  }, [stopEngines]);

  const stop = useCallback(() => {
    stopEngines();
    setRestarting(false);
    setLevel(0);
    setState(draftRef.current.trim() ? 'recorded' : 'idle');
  }, [stopEngines]);

  const cancel = useCallback(() => {
    stopEngines();
    draftRef.current = '';
    setDraft('');
    setLevel(0);
    setRestarting(false);
    setState('idle');
    optionsRef.current.onCancel?.();
  }, [stopEngines]);

  const commit = useCallback(
    async (onCommit?: (text: string) => void | Promise<void>) => {
      const text = draftRef.current.trim();
      if (!text) return;
      stopEngines();
      draftRef.current = '';
      setDraft('');
      setLevel(0);
      setRestarting(false);
      setState('idle');
      await (onCommit ?? optionsRef.current.onCommit)?.(text);
    },
    [stopEngines],
  );

  return { state, restarting, level, draft, start, stop, cancel, commit };
}

export default useVoiceInput;