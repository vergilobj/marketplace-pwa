// Браузерный Web Speech API (SpeechRecognition) — локальное распознавание речи.
// Не тянет npm-пакеты и не ходит на сервер: встроенная браузерная распознавалка.

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: any) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: any) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | null {
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

/** Поддерживает ли браузер распознавание речи. */
export function isSpeechSupported(): boolean {
  return typeof getCtor() === 'function';
}

/**
 * Запускает диктовку. Распознаёт одну фразу (ru-RU), по результату вызывает onResult.
 * Возвращает функцию принудительной остановки.
 */
export function startDictation(
  onResult: (text: string) => void,
  onEnd?: () => void,
  onError?: () => void,
): () => void {
  const Ctor = getCtor();
  if (!Ctor) {
    onEnd?.();
    return () => {};
  }

  const rec = new Ctor();
  rec.lang = 'ru-RU';
  rec.continuous = false;
  rec.interimResults = false;

  rec.onresult = (event: any) => {
    const transcript = event?.results?.[0]?.[0]?.transcript;
    if (typeof transcript === 'string' && transcript.trim()) {
      onResult(transcript.trim());
    }
  };

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    onEnd?.();
  };

  rec.onend = finish;
  rec.onerror = (event: any) => {
    // 'no-speech' и 'aborted' — не ошибка с точки зрения UX, просто завершение.
    if (event?.error === 'not-allowed' || event?.error === 'service-not-allowed') {
      onError?.();
    }
    finish();
  };

  try {
    rec.start();
  } catch {
    finish();
  }

  return () => {
    try {
      rec.stop();
    } catch {
      /* уже остановлена */
    }
  };
}

/**
 * Непрерывная диктовка: сессия распознавания живёт, пока её не остановят вручную.
 * Каждый финальный результат дополняет текст через onResult. onEnd вызывается
 * только при реальном завершении сессии (stop(), ошибка, конец речи).
 */
export function startContinuousDictation(
  onResult: (text: string) => void,
  onEnd?: () => void,
  onError?: () => void,
): () => void {
  const Ctor = getCtor();
  if (!Ctor) {
    onEnd?.();
    return () => {};
  }

  const rec = new Ctor();
  rec.lang = 'ru-RU';
  rec.continuous = true;
  rec.interimResults = false;

  rec.onresult = (event: any) => {
    const results = event?.results;
    if (!results) return;
    // Берём последний зафиксированный (isFinal) результат текущего события.
    let transcript = '';
    for (let i = 0; i < results.length; i++) {
      const res = results[i];
      if (res?.isFinal && res[0]?.transcript) {
        transcript = res[0].transcript.trim();
      }
    }
    if (transcript) {
      onResult(transcript);
    }
  };

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    onEnd?.();
  };

  rec.onend = finish;
  rec.onerror = (event: any) => {
    if (event?.error === 'not-allowed' || event?.error === 'service-not-allowed') {
      onError?.();
    }
    finish();
  };

  try {
    rec.start();
  } catch {
    finish();
  }

  return () => {
    try {
      rec.stop();
    } catch {
      /* уже остановлена */
    }
  };
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

      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
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