/**
 * DTO базы знаний (ЭТАП 3 ТЗ §6.1, §6.4).
 *
 * Статусы/источники — строки с @IsIn, а не enum: набор расширяется без
 * миграции БД (то же решение, что в feedback/consult).
 */
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Статусы знания (SPEC §4.1 + §6.3: STALE/REVIEW — устаревание и ревью). */
export const KNOWLEDGE_STATUSES = [
  'DRAFT',
  'ACTIVE',
  'STALE',
  'ARCHIVED',
  'REVIEW',
] as const;

export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];

/** Откуда знание пришло (SPEC §6.1 ПУТИ A/B/C). */
export const KNOWLEDGE_SOURCES = ['ADMIN', 'IMPORT', 'AI_APPROVED'] as const;

export type KnowledgeSource = (typeof KNOWLEDGE_SOURCES)[number];

/** Статусы кандидата: PENDING — из ответа админа, REVIEW — из ответа ИИ. */
export const KNOWLEDGE_CANDIDATE_STATUSES = [
  'PENDING',
  'REVIEW',
  'ACCEPTED',
  'REJECTED',
] as const;

export type KnowledgeCandidateStatus =
  (typeof KNOWLEDGE_CANDIDATE_STATUSES)[number];

/** Категории знаний (SPEC §4.1) — свободная строка, список для UI. */
export const KNOWLEDGE_CATEGORIES = [
  'доставка',
  'оплата',
  'гарантия',
  'товар',
  'прочее',
] as const;

/** Порог trgm, выше которого новая запись считается дублем (§6.3). */
export const KNOWLEDGE_DUPLICATE_SIMILARITY = 0.75;

/** Максимальная длина вопроса/ответа знания. */
export const KNOWLEDGE_QUESTION_MAX_LENGTH = 500;
export const KNOWLEDGE_ANSWER_MAX_LENGTH = 5000;
export const KNOWLEDGE_TAGS_MAX = 20;

/** Тело создания знания (§6.4 №18, ПУТЬ B). */
export class CreateKnowledgeDto {
  @IsString()
  @MinLength(3, { message: 'question must be at least 3 characters' })
  @MaxLength(KNOWLEDGE_QUESTION_MAX_LENGTH)
  question: string;

  @IsString()
  @MinLength(3, { message: 'answer must be at least 3 characters' })
  @MaxLength(KNOWLEDGE_ANSWER_MAX_LENGTH)
  answer: string;

  @IsOptional()
  @IsString()
  @MaxLength(KNOWLEDGE_ANSWER_MAX_LENGTH)
  answerShort?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  category?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(KNOWLEDGE_TAGS_MAX)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  productId?: string;

  @IsOptional()
  @IsIn(KNOWLEDGE_SOURCES, {
    message: `source must be one of: ${KNOWLEDGE_SOURCES.join(', ')}`,
  })
  source?: string;
}

/** Правка знания (§6.4 №19). Смена question → пересчёт questionNorm. */
export class UpdateKnowledgeDto {
  @IsOptional()
  @IsString()
  @MinLength(3, { message: 'question must be at least 3 characters' })
  @MaxLength(KNOWLEDGE_QUESTION_MAX_LENGTH)
  question?: string;

  @IsOptional()
  @IsString()
  @MinLength(3, { message: 'answer must be at least 3 characters' })
  @MaxLength(KNOWLEDGE_ANSWER_MAX_LENGTH)
  answer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(KNOWLEDGE_ANSWER_MAX_LENGTH)
  answerShort?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  category?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(KNOWLEDGE_TAGS_MAX)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  productId?: string;
}

/** Смена статуса (§6.4 №21). */
export class SetKnowledgeStatusDto {
  @IsIn(KNOWLEDGE_STATUSES, {
    message: `status must be one of: ${KNOWLEDGE_STATUSES.join(', ')}`,
  })
  status: string;
}

/**
 * Принятие кандидата (§6.4 №23, ПУТЬ A).
 *
 * Критично (FR-3.2): админ присылает СВОЮ формулировку вопроса. Если не
 * прислал — берём `questionDraft` кандидата (вопрос юзера как есть).
 */
export class ApproveCandidateDto {
  @IsOptional()
  @IsString()
  @MinLength(3, { message: 'question must be at least 3 characters' })
  @MaxLength(KNOWLEDGE_QUESTION_MAX_LENGTH)
  question?: string;

  @IsOptional()
  @IsString()
  @MinLength(3, { message: 'answer must be at least 3 characters' })
  @MaxLength(KNOWLEDGE_ANSWER_MAX_LENGTH)
  answer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(KNOWLEDGE_ANSWER_MAX_LENGTH)
  answerShort?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  category?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(KNOWLEDGE_TAGS_MAX)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  productId?: string;

  /** id существующего знания для слияния вместо создания дубля (§6.3). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  mergeInto?: string;
}

/** Предпросмотр поиска (§6.4 №26) — отладка порогов. */
export class SearchPreviewDto {
  @IsString()
  @MinLength(2, { message: 'text must be at least 2 characters' })
  @MaxLength(KNOWLEDGE_QUESTION_MAX_LENGTH)
  text: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  productId?: string;
}

/** Параметры списка знаний (§6.4 №17). */
export class ListKnowledgeQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  productId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  limit?: number;
}