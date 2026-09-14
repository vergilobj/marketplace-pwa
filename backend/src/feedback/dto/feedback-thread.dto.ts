import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { FEEDBACK_STATUSES, FeedbackStatus } from './update-feedback.dto';

/**
 * DTO треда обращения (ЭТАП 1 ТЗ §4.4).
 *
 * Тело сообщения принимается и как `body` (SPEC §4.4), и как `text` —
 * формулировка ТЗ на реализацию использует `{text}`. Оба варианта валидны,
 * приоритет у `body`; ни одного — 400 (см. `FeedbackService.resolveBody`).
 */
export class PostFeedbackMessageDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'body must not be empty' })
  @MaxLength(2000, { message: 'body must be at most 2000 characters' })
  body?: string;

  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'text must not be empty' })
  @MaxLength(2000, { message: 'text must be at most 2000 characters' })
  text?: string;
}

/** Типы сообщений треда. NOTE — внутренняя заметка, юзеру НЕ видна. */
export const FEEDBACK_MESSAGE_KINDS = [
  'TEXT',
  'NOTE',
  'AI_ANSWER',
  'SYSTEM',
  'KNOWLEDGE',
] as const;

export type FeedbackMessageKind = (typeof FEEDBACK_MESSAGE_KINDS)[number];

/** Типы, которые админ может отправить вручную. */
export const ADMIN_MESSAGE_KINDS = ['TEXT', 'NOTE'] as const;

/** Роли автора сообщения. */
export const FEEDBACK_AUTHOR_ROLES = ['USER', 'ADMIN', 'AI', 'SYSTEM'] as const;

export type FeedbackAuthorRole = (typeof FEEDBACK_AUTHOR_ROLES)[number];

/** Источники обращения (SPEC §4.1). */
export const FEEDBACK_SOURCES = [
  'FORM',
  'CONSULT',
  'PRODUCT',
  'BAZAR',
] as const;

/** Ответ админа: тело + опциональный `kind` (TEXT | NOTE). */
export class AdminPostFeedbackMessageDto extends PostFeedbackMessageDto {
  @IsOptional()
  @IsIn(ADMIN_MESSAGE_KINDS, {
    message: `kind must be one of: ${ADMIN_MESSAGE_KINDS.join(', ')}`,
  })
  kind?: string;
}

/**
 * Расширение CreateFeedbackDto (§4.4 №1): тема, товар, источник.
 * Отдельный класс — чтобы не менять существующий DTO (совместимость).
 */
export class CreateFeedbackThreadFieldsDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  productId?: string;

  @IsOptional()
  @IsIn(FEEDBACK_SOURCES, {
    message: `source must be one of: ${FEEDBACK_SOURCES.join(', ')}`,
  })
  source?: string;
}

/** Максимальная длина превью в уведомлении. */
export const FEEDBACK_PREVIEW_LENGTH = 80;

/** §4.5: не чаще одного уведомления админам на тред в 10 минут. */
export const FEEDBACK_ADMIN_NOTIFY_THROTTLE_MS = 10 * 60 * 1000;

/** §4.3: 7 дней тишины после ответа админа → CLOSED. */
export const FEEDBACK_AUTOCLOSE_DAYS = 7;

/** Статус «тред открыт» (для фильтров админки). */
export function isOpenStatus(status: string): boolean {
  return (FEEDBACK_OPEN_STATUSES as readonly string[]).includes(status);
}

const FEEDBACK_OPEN_STATUSES: readonly FeedbackStatus[] =
  FEEDBACK_STATUSES.filter((s) => s !== 'CLOSED');
