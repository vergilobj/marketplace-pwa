import { createHash } from 'crypto';

/**
 * A3: cart-метаданные корзины в `Transaction.payload.cart`.
 *
 * Схема НЕ меняется (`Transaction.orderId` NOT NULL, `clientRef` UNIQUE),
 * поэтому состав корзины живёт в JSON: на N заказов — ОДНА транзакция,
 * `orderId` = якорный заказ, `payload.cart.orderIds` = все участники.
 *
 * Модуль намеренно без зависимостей (только crypto): его читают и
 * PaymentsService, и PaymodWebhookHandler, и юнит-тесты — без DI-связывания.
 */
export interface CartMeta {
  anchorOrderId: string;
  orderIds: string[];
  total: number;
}

/** Извлечь валидные cart-метаданные; null — обычная (не корзинная) транзакция. */
export function readCartPayload(payload: unknown): CartMeta | null {
  const obj = asObject(payload);
  const cart = asObject(obj?.cart);
  if (!cart) return null;

  const rawIds = cart.orderIds;
  if (!Array.isArray(rawIds)) return null;
  const orderIds = rawIds.filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  );
  if (orderIds.length === 0) return null;

  const anchorOrderId =
    typeof cart.anchorOrderId === 'string' && cart.anchorOrderId
      ? cart.anchorOrderId
      : orderIds[0];

  const totalRaw = cart.total;
  const total =
    typeof totalRaw === 'number' ? totalRaw : Number(totalRaw ?? NaN);
  if (!Number.isFinite(total) || total <= 0) return null;

  return { anchorOrderId, orderIds, total };
}

/**
 * Детерминированный clientRef корзины: `mp-cart-<sha1(sorted ids)[0..16]>`.
 * Порядок id нормализуется сортировкой, поэтому одна и та же корзина всегда
 * даёт один и тот же адрес (sidecar идемпотентен по client_ref), а
 * UNIQUE(clientRef) не даёт создать вторую транзакцию на ту же корзину.
 */
export function cartClientRef(orderIds: string[]): string {
  const hash = createHash('sha1')
    .update([...orderIds].sort().join(','))
    .digest('hex')
    .slice(0, 16);
  return `mp-cart-${hash}`;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}