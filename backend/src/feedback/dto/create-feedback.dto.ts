import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

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
  @IsIn(FEEDBACK_TYPES as unknown as string[], {
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
}