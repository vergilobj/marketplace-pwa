interface SkeletonProps {
  className?: string;
  /** Круглый скелетон — для аватаров */
  circle?: boolean;
}

/** R17 — скелетон под тёмную тему (был bg-gray-200, светлый).
 *
 *  PERF-4: переведён на класс `.skeleton` из index.css. Раньше здесь были
 *  Tailwind-утилиты `animate-pulse bg-[var(--bg-3)]`, но у страниц с
 *  зелёным квадратом пульсации фактически не было, а сам класс скелетона
 *  в CSS отсутствовал. Теперь базовая анимация живёт в одном месте. */
export default function Skeleton({ className = '', circle = false }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={`skeleton ${circle ? 'skeleton-circle' : ''} ${className}`}
    />
  );
}

/** Полоса-строка текста (заголовок/абзац) фиксированной высоты. */
export function SkeletonLine({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton h-3.5 rounded-md ${className}`} />;
}

/** Плейсхолдер картинки. Высоту задаёт родитель через className. */
export function SkeletonImage({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton rounded-xl ${className}`} />;
}

/**
 * PERF-4 — честный скелетон страницы вместо зелёного квадрата 40×40.
 *
 * Повторяет структуру типовой страницы Базара: заголовок, подпись,
 * несколько строк контента и (опционально) блок картинки. Высота
 * подобрана под реальный контент, чтобы при подмене не было прыжка.
 *
 * Используется в: PostDetailPage, ProfilePage, PublicProfilePage,
 * NotificationsPage, OrdersPage, ReferralsPage, FavoritesPage,
 * MyProductsPage, WithdrawalsPage, ProductDetailPage.
 */
export function PageSkeleton({
  title = true,
  image = false,
  rows = 3,
  wide = false,
  className = '',
}: {
  /** Показывать ли строку-заголовок */
  title?: boolean;
  /** Показывать ли плейсхолдер картинки */
  image?: boolean;
  /** Сколько строк контента рисовать */
  rows?: number;
  /** Широкая страница (сетка каталога/профиля, max-w-5xl) вместо max-w-2xl */
  wide?: boolean;
  className?: string;
}) {
  return (
    <div className={`relative min-h-screen overflow-x-hidden ${className}`} role="status" aria-label="Загрузка">
      <div className={`relative ${wide ? 'max-w-5xl' : 'max-w-2xl'} mx-auto px-4 sm:px-6 pt-10 pb-20`}>
        {title && (
          <>
            <SkeletonLine className="h-7 w-2/5 mb-3" />
            <SkeletonLine className="h-3.5 w-1/4 mb-8" />
          </>
        )}

        {image && <SkeletonImage className="w-full h-56 mb-6" />}

        <div className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] p-6">
          <div className="flex items-center gap-3 mb-5">
            <Skeleton circle className="w-9 h-9 shrink-0" />
            <div className="flex-1 min-w-0">
              <SkeletonLine className="h-3.5 w-32 mb-2" />
              <SkeletonLine className="h-3 w-20" />
            </div>
          </div>

          <SkeletonLine className="h-5 w-3/5 mb-4" />

          <div className="space-y-2.5">
            {Array.from({ length: rows }).map((_, i) => (
              <SkeletonLine
                key={i}
                className={i === rows - 1 ? 'h-3.5 w-2/3' : 'h-3.5 w-full'}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * PERF-4 — скелетон карточки товара (сетка каталога/профиля).
 * Высота совпадает с реальной ProductCard: квадрат-фото + название + цена.
 */
export function ProductCardSkeleton() {
  return (
    <div className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] overflow-hidden">
      <SkeletonImage className="w-full aspect-square rounded-none" />
      <div className="p-3 space-y-2">
        <SkeletonLine className="h-3.5 w-4/5" />
        <SkeletonLine className="h-3.5 w-2/5" />
      </div>
    </div>
  );
}

/** PERF-4 — сетка скелетонов товаров (2/3/4 колонки, как в каталоге). */
export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4" role="status" aria-label="Загрузка">
      {Array.from({ length: count }).map((_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * PERF-4 — скелетон карточки поста для ленты.
 * Раньше лента рисовала `h-16` (64px) на реальную карточку ~350px → CLS.
 * Здесь: аватар + имя + 2 строки текста + картинка — как у настоящего поста.
 */
export function PostCardSkeleton({ withImage = true }: { withImage?: boolean }) {
  return (
    <div className="py-5">
      <div className="flex items-center gap-2 mb-2">
        <Skeleton circle className="w-5 h-5 shrink-0" />
        <SkeletonLine className="h-3 w-24" />
      </div>
      <SkeletonLine className="h-4 w-3/4 mb-2" />
      <SkeletonLine className="h-3 w-full mb-1.5" />
      <SkeletonLine className="h-3 w-2/3" />
      {withImage && <SkeletonImage className="w-full aspect-[16/10] mt-3 rounded-xl" />}
      <div className="flex items-center gap-3 mt-3">
        <SkeletonLine className="h-3 w-10" />
        <SkeletonLine className="h-3 w-10" />
      </div>
    </div>
  );
}

/**
 * PERF-4 — скелетон ленты: чередование постов и компактных строк товаров.
 * Высота каждой карточки ≈ реальной, поэтому подмена не двигает контент.
 */
export function FeedSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="divide-y divide-[var(--color-border)]" role="status" aria-label="Загрузка ленты">
      {Array.from({ length: count }).map((_, i) => (
        // Каждый 3-й — компактная строка товара (как в реальной ленте)
        i % 3 === 2 ? <ProductRowSkeleton key={i} /> : <PostCardSkeleton key={i} withImage={i % 2 === 0} />
      ))}
    </div>
  );
}

/** PERF-4 — скелетон компактной строки товара в ленте (56×56 + 2 строки). */
export function ProductRowSkeleton() {
  return (
    <div className="py-3.5 flex items-center gap-3.5">
      <Skeleton className="w-14 h-14 shrink-0" />
      <div className="flex-1 min-w-0 space-y-2">
        <SkeletonLine className="h-3.5 w-2/3" />
        <SkeletonLine className="h-3 w-1/3" />
      </div>
      <SkeletonLine className="h-3.5 w-16 shrink-0" />
    </div>
  );
}