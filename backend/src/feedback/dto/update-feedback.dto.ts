import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/** Статусы обработки обращения. */
export const FEEDBACK_STATUSES = ['NEW', 'IN_PROGRESS', 'CLOSED'] as const;

export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/** Подписи статусов для фронта/уведомлений. */
export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  NEW: 'Новое',
  IN_PROGRESS: 'В работе',
  CLOSED: 'Закрыто',
};

/**
 * Правка обращения админом. Оба поля опциональны: можно сменить только
 * статус, только заметку — или и то, и другое.
 */
export class UpdateFeedbackDto {
  @IsOptional()
  @IsIn(FEEDBACK_STATUSES as unknown as string[], {
    message: `status must be one of: ${FEEDBACK_STATUSES.join(', ')}`,
  })
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  adminNote?: string;
}