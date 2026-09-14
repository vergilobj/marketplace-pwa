import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

/**
 * Статусы треда обращения (ТЗ §4.3).
 *
 * Строки, а не enum в БД: новый статус добавляется правкой одного массива,
 * без миграции (валидация — здесь, через @IsIn).
 */
export const FEEDBACK_STATUSES = [
  'NEW',
  'IN_PROGRESS',
  'WAITING_ADMIN',
  'WAITING_USER',
  'AI_HANDLED',
  'CLOSED',
] as const;

export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/** Статусы, при которых тред считается «открытым» (не CLOSED). */
export const FEEDBACK_OPEN_STATUSES: readonly FeedbackStatus[] = [
  'NEW',
  'IN_PROGRESS',
  'WAITING_ADMIN',
  'WAITING_USER',
  'AI_HANDLED',
];

/** Подписи статусов для фронта/уведомлений. */
export const FEEDBACK_STATUS_LABELS: Record<string, string> = {
  NEW: 'Новое',
  IN_PROGRESS: 'В работе',
  WAITING_ADMIN: 'Ждёт ответа администратора',
  WAITING_USER: 'Ждёт вашего ответа',
  AI_HANDLED: 'Отвечает ИИ-консультант',
  CLOSED: 'Закрыто',
};

/**
 * Правка обращения админом.
 *
 * Все поля опциональны: можно сменить только статус, только заметку, только
 * исполнителя — или всё вместе. `adminNote` сохранён (DEPRECATED) ради
 * обратной совместимости: старый PATCH продолжает работать.
 */
export class UpdateFeedbackDto {
  @IsOptional()
  @IsIn(FEEDBACK_STATUSES, {
    message: `status must be one of: ${FEEDBACK_STATUSES.join(', ')}`,
  })
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  adminNote?: string;

  /**
   * Назначить/снять исполнителя. `null` явно снимает назначение
   * (пустая строка тоже → null, чтобы фронт мог слать '' без 400).
   */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  assignedAdminId?: string | null;
}
