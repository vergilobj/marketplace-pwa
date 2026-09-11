interface SkeletonProps {
  className?: string;
  /** Круглый скелетон — для аватаров */
  circle?: boolean;
}

/** R17 — скелетон под тёмную тему (был bg-gray-200, светлый). */
export default function Skeleton({ className = '', circle = false }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse bg-[var(--bg-3)] ${circle ? 'rounded-full' : 'rounded-xl'} ${className}`}
    />
  );
}