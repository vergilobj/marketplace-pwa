import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { FEEDBACK_SOURCES } from './feedback-thread.dto';

/**
 * Типы обращений. Строки, а не enum в БД: новый тип добавляется правкой
 * одного массива, без миграции (валидация — здесь, через @IsIn).
 */
export const FEEDBACK_TYPES = [
  'SUGGESTION',
  'REQUEST',
  'QUESTION',
  'CONSULTATION',
  'BUG',
  'OTHER',
] as const;

export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

/** Человекочитаемые подписи — для текста уведомления админам. */
export const FEEDBACK_TYPE_LABELS: Record<FeedbackType, string> = {
  SUGGESTION: 'предложение',
  REQUEST: 'просьба',
  QUESTION: 'вопрос',
  CONSULTATION: 'консультация',
  BUG: 'баг',
  OTHER: 'другое',
};

export class CreateFeedbackDto {
  @IsIn(FEEDBACK_TYPES, {
    message: `type must be one of: ${FEEDBACK_TYPES.join(', ')}`,
  })
  type: string;

  @IsString()
  @MinLength(3, { message: 'message must be at least 3 characters' })
  @MaxLength(2000, { message: 'message must be at most 2000 characters' })
  message: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  contact?: string;

  /** Короткая тема треда (§4.1). Если не передана — выведем из message. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  /** Товар, из карточки которого создан тред (§4.4 №1, FR-1.7). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  productId?: string;

  /** Источник обращения: FORM (по умолчанию) | CONSULT | PRODUCT | BAZAR. */
  @IsOptional()
  @IsIn(FEEDBACK_SOURCES, {
    message: `source must be one of: ${FEEDBACK_SOURCES.join(', ')}`,
  })
  source?: string;
}
