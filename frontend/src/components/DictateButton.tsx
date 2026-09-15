import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Mic } from 'lucide-react';
import { isSpeechSupported } from '../utils/speech';
import { useVoiceInput } from '../hooks/useVoiceInput';
import DictationBars from './ui/DictationBars';

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

/** Ширина кнопки в режиме записи: полосы должны быть различимы, но кнопка
 *  остаётся компактной (в поиске на главной она лежит поверх инпута). */
const RECORDING_WIDTH = 120;

/**
 * Кнопка-микрофон: непрерывная диктовка с явной индикацией состояния.
 *
 * Раньше здесь был одноразовый `startDictation`: после первой фразы движок
 * умирал, и «микрофон погас» выглядело так же, как «микрофон слушает» —
 * пользователь не понимал, что происходит. Теперь движок непрерывный
 * (авто-рестарт на мобильных), а кнопка показывает состояния:
 * слушает (живой саундбар + зелёная точка), перезапускается (жёлтая точка),
 * молчит (обычный микрофон).
 *
 * Логика диктовки и аудио-метра — общий хук `useVoiceInput`, саундбар —
 * общий `DictationBars` (тот же, что в Базаре). Копий нет.
 *
 * Высота кнопки остаётся тач-таргетом (классы `w-11 h-11` от вызывающей
 * стороны дают 44px) — в режиме записи расширяется только ширина.
 *
 * Не рендерится, если браузер не поддерживает SpeechRecognition.
 */
export default function DictateButton({
  onResult,
  size = 18,
  className = '',
  onError,
}: DictateButtonProps) {
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

  const voice = useVoiceInput({
    onFinal: (text) => onResultRef.current(text),
    onError: (message) => onErrorRef.current?.(message),
  });

  if (!isSpeechSupported()) return null;

  const listening = voice.state === 'listening';
  const restarting = voice.restarting;

  const toggle = () => {
    if (listening) {
      voice.stop();
      return;
    }
    voice.start();
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
      data-listening={listening ? 'true' : 'false'}
      className={`shrink-0 flex items-center justify-center rounded-lg transition-colors overflow-hidden ${className}`}
      style={{
        background: listening ? 'rgba(34,197,94,0.14)' : 'rgba(255,255,255,0.04)',
        color: listening ? '#34d399' : 'var(--color-muted)',
        border: listening ? '1px solid rgba(52,211,153,0.5)' : '1px solid transparent',
        // В режиме записи кнопка расширяется под саундбар; высоту задаёт
        // вызывающая сторона (тач-таргет ≥44px не ломаем).
        width: listening ? RECORDING_WIDTH : undefined,
      }}
      animate={listening ? { scale: [1, 1.04, 1] } : { scale: 1 }}
      transition={listening ? { repeat: Infinity, duration: 1.1, ease: 'easeInOut' } : { duration: 0.15 }}
    >
      {listening ? (
        // Живой саундбар: полосы реагируют на реальную громкость.
        <span className="relative flex items-center w-full px-2">
          <DictationBars
            level={voice.level}
            height={20}
            className="flex-1 min-w-0 flex items-center justify-between overflow-hidden"
          />
          {/* Индикатор живости движка: зелёный — слушает, жёлтый — перезапускается.
              Без него «тихая смерть» распознавания выглядела как рабочая запись. */}
          <span
            aria-hidden="true"
            className="absolute rounded-full"
            style={{
              width: 6,
              height: 6,
              right: 2,
              top: -2,
              background: restarting ? '#fbbf24' : '#22c55e',
              boxShadow: restarting
                ? '0 0 0 2px rgba(251,191,36,0.25)'
                : '0 0 0 2px rgba(34,197,94,0.25)',
            }}
          />
        </span>
      ) : (
        // Иконки фиксированного бокса: Mic и Square разного размера давали
        // сдвиг кнопки при старте/стопе записи.
        <span className="relative flex items-center justify-center" style={{ width: size + 2, height: size + 2 }}>
          <Mic size={size} className="absolute" />
        </span>
      )}
    </motion.button>
  );
}