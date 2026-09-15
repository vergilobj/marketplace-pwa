import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Mic, Square } from 'lucide-react';
import {
  isSpeechSupported,
  startContinuousDictation,
  type SpeechErrorKind,
} from '../utils/speech';

interface DictateButtonProps {
  /**
   * Куда вставляется распознанный текст. Вызывается на каждый ФИНАЛЬНЫЙ
   * фрагмент речи — семантику (замена или дополнение) задаёт вызывающая сторона.
   */
  onResult: (text: string) => void;
  /** Размер иконки в px. */
  size?: number;
  /** Доп. класс для позиционирования/отступов. */
  className?: string;
  /** Фатальная ошибка распознавания — текст готов для toast. */
  onError?: (msg: string) => void;
}

/**
 * Кнопка-микрофон: непрерывная диктовка с явной индикацией состояния.
 *
 * Раньше здесь был одноразовый `startDictation`: после первой фразы движок
 * умирал, и «микрофон погас» выглядело так же, как «микрофон слушает» —
 * пользователь не понимал, что происходит. Теперь движок непрерывный
 * (авто-рестарт на мобильных), а кнопка показывает три состояния:
 * слушает (пульс + зелёная точка), перезапускается (жёлтая точка),
 * молчит (обычный микрофон).
 *
 * Не рендерится, если браузер не поддерживает SpeechRecognition.
 */
export default function DictateButton({
  onResult,
  size = 18,
  className = '',
  onError,
}: DictateButtonProps) {
  const [listening, setListening] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);

  /**
   * Запись в ref во время рендера запрещена (react-hooks/refs): рендер должен
   * быть чистым. Синхронизируем актуальные колбэки после коммита, в эффекте.
   */
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    return () => stopRef.current?.();
  }, []);

  if (!isSpeechSupported()) return null;

  const toggle = () => {
    if (listening) {
      stopRef.current?.();
      stopRef.current = null;
      setListening(false);
      setRestarting(false);
      return;
    }

    setListening(true);
    setRestarting(false);
    stopRef.current = startContinuousDictation({
      onFinal: (text) => onResultRef.current(text),
      onStatus: (status) => setRestarting(status === 'restarting'),
      onError: (_kind: SpeechErrorKind, message: string) => {
        setListening(false);
        setRestarting(false);
        onErrorRef.current?.(message);
      },
      onEnd: () => {
        setListening(false);
        setRestarting(false);
        stopRef.current = null;
      },
    });
  };

  const label = listening
    ? restarting
      ? 'Диктовка: перезапуск'
      : 'Остановить диктовку'
    : 'Голосовой ввод';

  return (
    <motion.button
      type="button"
      onClick={toggle}
      whileTap={{ scale: 0.92 }}
      aria-label={label}
      aria-pressed={listening}
      title={label}
      className={`shrink-0 flex items-center justify-center rounded-lg transition-colors ${className}`}
      style={{
        background: listening ? 'rgba(34,197,94,0.14)' : 'rgba(255,255,255,0.04)',
        color: listening ? '#34d399' : 'var(--color-muted)',
        border: listening ? '1px solid rgba(52,211,153,0.5)' : '1px solid transparent',
      }}
      animate={listening ? { scale: [1, 1.12, 1] } : { scale: 1 }}
      transition={listening ? { repeat: Infinity, duration: 1.1, ease: 'easeInOut' } : { duration: 0.15 }}
    >
      {/* Иконки фиксированного бокса: Mic и Square разного размера давали
          сдвиг кнопки при старте/стопе записи. */}
      <span className="relative flex items-center justify-center" style={{ width: size + 2, height: size + 2 }}>
        {listening ? <Square size={size - 2} className="absolute" /> : <Mic size={size} className="absolute" />}
        {/* Индикатор живости движка: зелёный — слушает, жёлтый — перезапускается.
            Без него «тихая смерть» распознавания выглядела как рабочая запись. */}
        {listening && (
          <span
            aria-hidden="true"
            className="absolute rounded-full"
            style={{
              width: 6,
              height: 6,
              right: -1,
              top: -1,
              background: restarting ? '#fbbf24' : '#22c55e',
              boxShadow: restarting
                ? '0 0 0 2px rgba(251,191,36,0.25)'
                : '0 0 0 2px rgba(34,197,94,0.25)',
            }}
          />
        )}
      </span>
    </motion.button>
  );
}