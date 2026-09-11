/**
 * S1 (NH5-ad): оплата рекламного заказа.
 *
 * Реклама активируется ТОЛЬКО после реального депозита, поэтому фронт обязан
 * провести рекламодателя через экран оплаты USDT (BSC) — тот же паттерн, что
 * в CheckoutPage для обычного товара.
 *
 * Здесь только чистые функции — вся логика UI в CreateAdPage.
 */

/** Окно оплаты — как в чеккауте товара. */
export const AD_PAYMENT_WINDOW_MS = 15 * 60 * 1000;

/** Терминальные статусы транзакции paymod: реклама оплачена. */
export const AD_FINAL_STATUSES = ['CONFIRMED', 'SWEPT'] as const;

/** Статус оплачен, дальше поллить нечего. */
export const isAdPaymentFinal = (status?: string | null): boolean =>
  !!status && (AD_FINAL_STATUSES as readonly string[]).includes(status);

export const AD_STATUS_LABEL: Record<string, string> = {
  PENDING: 'Ожидание оплаты',
  CONFIRMED: 'Оплачено',
  SWEPT: 'Зачислено',
  FAILED: 'Ошибка',
};

export const adPaymentStatusLabel = (status?: string | null): string =>
  status ? AD_STATUS_LABEL[status] || status : 'Ожидание оплаты';

/** Секунды → MM:SS, отрицательные и мусор схлопываются в 00:00. */
export const formatTimeLeft = (seconds: number): string => {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const m = Math.floor(s / 60)
    .toString()
    .padStart(2, '0');
  return `${m}:${(s % 60).toString().padStart(2, '0')}`;
};

/** Стоимость размещения = цена за день × дни. Нечисло → 0. */
export const adTotal = (pricePerDay: number, days: number): number => {
  if (!Number.isFinite(pricePerDay) || !Number.isFinite(days)) return 0;
  return Math.max(0, pricePerDay) * Math.max(0, days);
};

/**
 * Достаёт orderId из ответа POST /posts/ad.
 * Бэкенд отдаёт пост с `orderId` (поле Post.orderId) и relation `order`.
 * Принимаем оба варианта — если ни одного нет, платить нечем.
 */
export const extractAdOrderId = (post: unknown): string | null => {
  const p = post as { orderId?: string | null; order?: { id?: string } | null } | null;
  return p?.orderId ?? p?.order?.id ?? null;
};