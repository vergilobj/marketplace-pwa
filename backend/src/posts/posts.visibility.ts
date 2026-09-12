import { OrderStatus, EscrowStatus, Prisma } from '@prisma/client';

/**
 * A5.7: реклама попадает в публичную ленту ТОЛЬКО после реальной оплаты.
 *
 * Условие «isAd: true, isPinned: true, adExpireDate >= now» опирается на
 * `isPinned`/`adExpireDate`, а их выставляет `activateAdForOrder` — и только он
 * (он же требует Order PAID + escrow HELD). Но одного этого условия мало:
 * любой код, который проставит `isPinned` напрямую (устаревшая сборка, ручная
 * правка в БД, будущий рефактор), снова покажет неоплаченную рекламу — ровно
 * то, что видел владелец («рекламу не оплатил, а она выложилась»).
 *
 * Поэтому видимость рекламы привязана к её ЗАКАЗУ, а не только к флагам поста:
 * у рекламного поста обязан быть Order со статусом PAID и эскроу в HELD.
 * Закрытие эскроу (REFUNDED/RELEASED) рекламу из ленты убирает, потому что
 * escrow.service при закрытии сбрасывает `isPinned = false`.
 *
 * Обычные посты (`isAd: false`) это условие не затрагивает.
 */
export const PAID_AD_ORDER: Prisma.PostWhereInput = {
  order: {
    is: {
      status: OrderStatus.PAID,
      escrowStatus: EscrowStatus.HELD,
    },
  },
};

/**
 * Публичная видимость поста: не скрыт + реклама только оплаченная.
 *
 * ФАБРИКА, а не константа: `adExpireDate >= now` должен сравниваться с моментом
 * ЗАПРОСА. Константа с `new Date()` вычислила бы дату один раз при импорте
 * модуля, и после рестарта процесса «сейчас» замерзло бы — просроченная реклама
 * висела бы в ленте вечно.
 */
export function publicAdVisibility(
  now: Date = new Date(),
): Prisma.PostWhereInput {
  return {
    isHidden: false,
    OR: [
      { isAd: false },
      {
        isAd: true,
        isPinned: true,
        adExpireDate: { gte: now },
        ...PAID_AD_ORDER,
      },
    ],
  };
}
