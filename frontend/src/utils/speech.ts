// Браузерный Web Speech API (SpeechRecognition) — локальное распознавание речи.
// Не тянет npm-пакеты и не ходит на сервер: встроенная браузерная распознавалка.

/**
 * Минимальные структурные типы Web Speech API. В lib.dom.d.ts SpeechRecognition
 * до сих пор не описан, поэтому объявляем только то, что реально используем.
 */
type SpeechRecognitionAlternative = {
  transcript: string;
  confidence: number;
};

type SpeechRecognitionResult = {
  readonly length: number;
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternative;
};

type SpeechRecognitionResultList = {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
};

type SpeechRecognitionEvent = {
  results: SpeechRecognitionResultList;
  /** Индекс первого результата, который относится к ТЕКУЩЕМУ событию. */
  resultIndex: number;
};

type SpeechRecognitionErrorEvent = {
  error: string;
  message?: string;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | null {
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

/** Поддерживает ли браузер распознавание речи. */
export function isSpeechSupported(): boolean {
  return typeof getCtor() === 'function';
}

/** Понятный наружу код ошибки распознавания. */
export type SpeechErrorKind =
  | 'not-allowed'
  | 'service-not-allowed'
  | 'no-speech'
  | 'audio-capture'
  | 'network'
  | 'aborted'
  | 'unknown';

/** Человеческий текст для каждого кода — UI показывает его как есть. */
export const SPEECH_ERROR_MESSAGES: Record<SpeechErrorKind, string> = {
  'not-allowed': 'Нет доступа к микрофону. Разрешите доступ в настройках браузера.',
  'service-not-allowed': 'Браузер запретил распознавание речи. Проверьте настройки.',
  'no-speech': 'Ничего не расслышал — говорите ближе к микрофону.',
  'audio-capture': 'Микрофон не найден. Подключите его и попробуйте снова.',
  network: 'Распознавание речи без сети не работает.',
  aborted: 'Распознавание прервано.',
  unknown: 'Распознавание остановилось. Нажмите микрофон ещё раз.',
};

const KNOWN_KINDS: readonly SpeechErrorKind[] = [
  'not-allowed',
  'service-not-allowed',
  'no-speech',
  'audio-capture',
  'network',
  'aborted',
];

function normalizeErrorKind(raw: string): SpeechErrorKind {
  return (KNOWN_KINDS as readonly string[]).includes(raw)
    ? (raw as SpeechErrorKind)
    : 'unknown';
}

/**
 * Ошибки, после которых перезапускаться бессмысленно: доступ запрещён или
 * микрофона нет вовсе. Повторный `start()` даст тот же отказ и цикл запросов.
 */
const FATAL_KINDS = new Set<SpeechErrorKind>([
  'not-allowed',
  'service-not-allowed',
  'audio-capture',
]);

/**
 * Потолок автоперезапусков. На Android Chrome движок умирает после каждой
 * фразы, поэтому перезапуск — норма; но если он умирает мгновенно и всегда,
 * без потолка получится вечный цикл. 50 хватает на длинный монолог.
 */
export const MAX_AUTO_RESTARTS = 50;

/** Пауза перед автоперезапуском: мгновенный `start()` в `onend` бросает. */
const RESTART_DELAY_MS = 250;

/** Состояние живой сессии диктовки. */
export type DictationStatus = 'listening' | 'restarting';

export interface ContinuousDictationHandlers {
  /** Каждый ФИНАЛЬНЫЙ фрагмент речи (может прийти несколько за событие). */
  onFinal?: (text: string) => void;
  /** Живой (неподтверждённый) текст. Пустая строка — живой текст сброшен. */
  onInterim?: (text: string) => void;
  /** Фатальная ошибка: сессия закончилась, сама не поднимется. */
  onError?: (kind: SpeechErrorKind, message: string) => void;
  /** Нефатальная помеха (`no-speech`, `network`) — движок продолжает слушать. */
  onNotice?: (kind: SpeechErrorKind, message: string) => void;
  /** Сессия диктовки окончательно завершена (ручной stop или фатальная ошибка). */
  onEnd?: () => void;
  /** Живость движка: слушает / перезапускается. */
  onStatus?: (status: DictationStatus) => void;
}

/**
 * Непрерывная диктовка — единственный движок распознавания в приложении.
 *
 * Чем отличается от наивного `rec.start()`:
 *  - `continuous` + `interimResults`: сессия живёт до ручной остановки, есть
 *    живой текст;
 *  - собираются ВСЕ финальные результаты события (раньше брался последний —
 *    середина фразы молча терялась);
 *  - авто-рестарт в `onend`: Android Chrome игнорирует `continuous = true` и
 *    глушит движок после каждой фразы, поэтому сессию поднимаем сами;
 *  - ошибки разведены: фатальные (`not-allowed`, `service-not-allowed`,
 *    `audio-capture`) отдаются в `onError` и НЕ перезапускаются, помехи
 *    (`no-speech`, `network`) идут в `onNotice` и не рвут запись.
 *
 * Совместимость: старый позиционный вызов
 * `startContinuousDictation(onResult, onEnd, onError)` продолжает работать —
 * первый аргумент может быть функцией. Второй/третий аргументы в этом режиме
 * трактуются как `onEnd` / `onError`.
 *
 * @returns функция остановки: снимает флаг «слушаем», глушит движок и
 *          микрофон, после неё авто-рестарт не срабатывает.
 */
export function startContinuousDictation(
  handlersOrOnFinal: ((text: string) => void) | ContinuousDictationHandlers,
  legacyOnEnd?: () => void,
  legacyOnError?: (kind: SpeechErrorKind, message: string) => void,
): () => void {
  const handlers: ContinuousDictationHandlers =
    typeof handlersOrOnFinal === 'function'
      ? { onFinal: handlersOrOnFinal, onEnd: legacyOnEnd, onError: legacyOnError }
      : handlersOrOnFinal;

  const { onFinal, onInterim, onError, onNotice, onEnd, onStatus } = handlers;

  const Ctor = getCtor();
  if (!Ctor) {
    onEnd?.();
    return () => {};
  }

  const rec = new Ctor();
  rec.lang = 'ru-RU';
  rec.continuous = true;
  rec.interimResults = true;

  /** Пользователь вызвал stop() — автоперезапуск запрещён. */
  let stopped = false;
  /** Ошибка, после которой подниматься нельзя. */
  let fatal = false;
  /** onEnd уже отдан — второй раз не дёргаем. */
  let ended = false;
  let restarts = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const emitEnd = () => {
    if (ended) return;
    ended = true;
    onEnd?.();
  };

  const emitError = (kind: SpeechErrorKind) => {
    onError?.(kind, SPEECH_ERROR_MESSAGES[kind]);
  };

  const emitNotice = (kind: SpeechErrorKind) => {
    onNotice?.(kind, SPEECH_ERROR_MESSAGES[kind]);
  };

  rec.onresult = (event: SpeechRecognitionEvent) => {
    const results = event?.results;
    if (!results) return;

    // resultIndex — граница «уже отдано в прошлых событиях». Идём от неё и
    // копим ВСЕ финальные результаты события, а не только последний.
    const start =
      typeof event.resultIndex === 'number' && event.resultIndex >= 0
        ? event.resultIndex
        : 0;

    let finalText = '';
    let interimText = '';
    for (let i = start; i < results.length; i++) {
      const res = results[i];
      if (!res) continue;
      const transcript = res[0]?.transcript ?? '';
      if (res.isFinal) finalText += transcript;
      else interimText += transcript;
    }

    const final = finalText.trim();
    if (final) onFinal?.(final);
    // Живой текст отдаём всегда: пустая строка означает «сбросить».
    onInterim?.(interimText.trim());
  };

  rec.onerror = (event: SpeechRecognitionErrorEvent) => {
    const kind = normalizeErrorKind(
      typeof event?.error === 'string' ? event.error : '',
    );

    if (FATAL_KINDS.has(kind)) {
      fatal = true;
      emitError(kind);
      // Следом придёт onend — он завершит сессию без перезапуска.
      return;
    }

    if (kind === 'aborted' && stopped) return;

    // no-speech / network / aborted — движок поднимется сам, сессию не рвём.
    if (kind !== 'aborted') emitNotice(kind);
  };

  rec.onend = () => {
    if (stopped || fatal) {
      emitEnd();
      return;
    }

    if (restarts >= MAX_AUTO_RESTARTS) {
      fatal = true;
      emitError('unknown');
      emitEnd();
      return;
    }

    restarts += 1;
    onStatus?.('restarting');
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (stopped || fatal) {
        emitEnd();
        return;
      }
      try {
        rec.start();
        onStatus?.('listening');
      } catch {
        fatal = true;
        emitEnd();
      }
    }, RESTART_DELAY_MS);
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;

    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }

    // Снимаем колбэки до abort(): после ручной остановки движок может
    // выплюнуть onend/onerror, и они не должны ничего запускать.
    rec.onresult = null;
    rec.onend = null;
    rec.onerror = null;

    try {
      rec.stop();
    } catch {
      /* уже остановлен */
    }
    try {
      rec.abort();
    } catch {
      /* уже остановлен */
    }

    onInterim?.('');
    emitEnd();
  };

  try {
    rec.start();
    onStatus?.('listening');
  } catch {
    fatal = true;
    emitEnd();
  }

  return stop;
}

/**
 * Измеритель уровня громкости с микрофона через Web Audio API.
 * Запускает getUserMedia → AudioContext → AnalyserNode, в цикле requestAnimationFrame
 * считает RMS/амплитуду, нормализует в 0..1 и вызывает onLevel.
 * Возвращает функцию остановки (закрывает audioContext и треки потока).
 * При отказе в доступе к микрофону молча отключается — саундбар останется статичным.
 */
export function startAudioMeter(
  onLevel: (normalized: number) => void,
): () => void {
  let rafId = 0;
  let audioContext: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (rafId) cancelAnimationFrame(rafId);
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
    }
    if (audioContext && audioContext.state !== 'closed') {
      audioContext.close().catch(() => {});
    }
  };

  if (!navigator.mediaDevices?.getUserMedia) {
    return stop;
  }

  navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then((s) => {
      if (stopped) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = s;

      const Ctx =
        window.AudioContext ||
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) {
        stop();
        return;
      }
      audioContext = new Ctx();
      const source = audioContext.createMediaStreamSource(s);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.fftSize);

      const tick = () => {
        if (stopped) return;
        analyser.getByteTimeDomainData(dataArray);

        // RMS по time-domain данным: центрируем вокруг 128 и нормализуем.
        let sumSquares = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const v = (dataArray[i] - 128) / 128;
          sumSquares += v * v;
        }
        const rms = Math.sqrt(sumSquares / dataArray.length);

        // Логарифмическая нормализация, чтобы слабый голос был заметен,
        // а шум фона не давал постоянных скачков.
        const normalized = Math.min(1, Math.max(0, rms * 4));
        onLevel(normalized);

        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    })
    .catch(() => {
      // Нет доступа к микрофону — молча отключаемся, запись не роняем.
      stop();
    });

  return stop;
}