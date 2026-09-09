import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Mic, Square } from 'lucide-react';
import { isSpeechSupported, startDictation } from '../utils/speech';

interface DictateButtonProps {
  /** Куда вставляется распознанный текст. */
  onResult: (text: string) => void;
  /** Размер иконки в px. */
  size?: number;
  /** Доп. класс для позиционирования/отступов. */
  className?: string;
}

/**
 * Кнопка-микрофон: запускает диктовку, пульсирует в активном состоянии,
 * возвращается в исходное после окончания/ошибки. Не рендерится, если
 * браузер не поддерживает SpeechRecognition.
 */
export default function DictateButton({ onResult, size = 18, className = '' }: DictateButtonProps) {
  const [listening, setListening] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  useEffect(() => {
    return () => stopRef.current?.();
  }, []);

  if (!isSpeechSupported()) return null;

  const toggle = () => {
    if (listening) {
      stopRef.current?.();
      return;
    }
    setListening(true);
    stopRef.current = startDictation(
      (text) => onResultRef.current(text),
      () => setListening(false),
      () => setListening(false),
    );
  };

  return (
    <motion.button
      type="button"
      onClick={toggle}
      whileTap={{ scale: 0.92 }}
      aria-label={listening ? 'Остановить диктовку' : 'Голосовой ввод'}
      title={listening ? 'Остановить диктовку' : 'Голосовой ввод'}
      className={`shrink-0 flex items-center justify-center rounded-lg transition-colors ${className}`}
      style={{
        background: listening ? 'rgba(34,197,94,0.14)' : 'rgba(255,255,255,0.04)',
        color: listening ? '#34d399' : 'var(--color-muted)',
        border: listening ? '1px solid rgba(52,211,153,0.5)' : '1px solid transparent',
      }}
      animate={listening ? { scale: [1, 1.12, 1] } : { scale: 1 }}
      transition={listening ? { repeat: Infinity, duration: 1.1, ease: 'easeInOut' } : { duration: 0.15 }}
    >
      {listening ? <Square size={size} /> : <Mic size={size} />}
    </motion.button>
  );
}