import { useMemo } from 'react';
import { motion } from 'framer-motion';

/**
 * Саундбар — ряд вертикальных полос с градиентом #22c55e → #34d399.
 * Реагирует на реальный уровень громкости (level: 0..1).
 * Каждая полоса имеет свою фазовую вариацию, чтобы играли не синхронно.
 * Плавные пружинные переходы высоты через framer-motion.
 *
 * Полос 28 (а не 160): контейнер записи — flex-1 в ряду с двумя кнопками по
 * 48px, на 390px ему достаётся ~230px. 160 полос по 2px + 159 гэпов давали
 * ~480px и саундбар уезжал за вьюпорт. Ширина полосы здесь в процентах
 * (flex-basis 0 + flex-grow), поэтому ряд всегда вписывается в родителя.
 *
 * Один источник правды: этот компонент используется в Базаре (единственное
 * место с микрофоном) — копий быть не должно.
 */

/** Эталонный контейнер полос (Базар): растягивается по родителю. */
const BAR_ROW_CLASS =
  'flex-1 min-w-0 max-w-full flex items-center justify-between overflow-hidden';

interface DictationBarsProps {
  /** Уровень громкости 0..1 (из startAudioMeter). */
  level: number;
  /** Высота контейнера полос. По умолчанию — эталонная, 48px. */
  height?: number;
  /** Доп. классы контейнера (компактные точки входа задают свою ширину). */
  className?: string;
}

export default function DictationBars({
  level,
  height = 48,
  className = BAR_ROW_CLASS,
}: DictationBarsProps) {
  const bars = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => {
        // Фазовая вариация: каждая полоса чуть иначе реагирует на голос.
        const phase = 0.3 + 0.7 * Math.abs(Math.sin(i * 0.35 + 0.6));
        return { id: i, phase };
      }),
    [],
  );

  const barHeight = (phase: number) => Math.max(2, 2 + level * 46 * phase);

  return (
    <div
      className={className}
      style={{ height, gap: 2 }}
      aria-hidden="true"
      data-testid="dictation-bars"
    >
      {bars.map((b) => (
        <motion.span
          key={b.id}
          className="rounded-full shrink min-w-0"
          data-bar={b.id}
          style={{
            flex: '1 1 0',
            maxWidth: 3,
            background: 'linear-gradient(to top, #22c55e, #34d399)',
          }}
          initial={false}
          animate={{ height: barHeight(b.phase) }}
          transition={{ type: 'spring', stiffness: 420, damping: 22, mass: 0.4 }}
        />
      ))}
    </div>
  );
}