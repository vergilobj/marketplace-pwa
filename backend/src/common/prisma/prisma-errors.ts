import { Prisma } from '@prisma/client';

/**
 * GAPS-A: Prisma P2025 («An operation failed because it depends on one or more
 * records that were required but not found»).
 *
 * До фикса `prisma.X.update({where:{id}})`/`delete` по несуществующему id
 * бросал P2025 → AllExceptionsFilter отдавал generic 500. Клиент не отличал
 * «нет такой сущности» от сбоя сервера. Теперь такие места отдают 404.
 *
 * Проверяем и `instanceof` (штатный путь), и `code` — в юнит-тестах/моках
 * ошибка может прийти структурно совместимым объектом без прототипа Prisma
 * (тот же приём, что в PaymentsService.isUniqueViolation).
 */
export function isRecordNotFound(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    return e.code === 'P2025';
  }
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: unknown }).code === 'P2025'
  );
}

/** Человекочитаемые сообщения 404 по типам сущностей (единый стиль). */
export const NOT_FOUND_MESSAGES = {
  product: 'Товар не найден',
  post: 'Пост не найден',
  comment: 'Комментарий не найден',
  invite: 'Инвайт не найден',
  user: 'Пользователь не найден',
  order: 'Заказ не найден',
  notification: 'Уведомление не найдено',
} as const;