/**
 * DTO модуля ИИ-консультанта (ЭТАП 2 ТЗ §5.5).
 *
 * Все поля — обычные строки/булевы, без enum: набор источников и настроек
 * расширяется без миграции (как в feedback).
 */
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Источники ответа консультанта (§5.2 ШАГ 6). */
export const CONSULT_SOURCES = [
  'KNOWLEDGE',
  'CATALOG',
  'LLM',
  'FALLBACK',
] as const;

export type ConsultSource = (typeof CONSULT_SOURCES)[number];

/** Ключи настроек консультанта (§5.6). */
export const CONSULT_SETTING_KEYS = [
  'consult_enabled',
  'consult_confidence_threshold',
  'consult_hint_threshold',
  'consult_max_ai_turns',
  'consult_rate_limit_per_hour',
  'consult_product_context',
] as const;

/** Порог, выше которого отвечаем прямо из базы знаний. */
export const DEFAULT_CONSULT_CONFIDENCE_THRESHOLD = 0.45;

/** Порог, выше которого подкладываем знания в промпт (RAG-lite). */
export const DEFAULT_CONSULT_HINT_THRESHOLD = 0.25;

/** Сколько ответов ИИ подряд до настойчивого предложения позвать админа. */
export const DEFAULT_CONSULT_MAX_AI_TURNS = 5;

/** Антиспам: вопросов в час на пользователя (§5.2 ШАГ 0). */
export const DEFAULT_CONSULT_RATE_LIMIT_PER_HOUR = 20;

/** Включён ли консультант по умолчанию. */
export const DEFAULT_CONSULT_ENABLED = true;

/** Подтягивать ли товарный контекст по умолчанию. */
export const DEFAULT_CONSULT_PRODUCT_CONTEXT = true;

/** Максимальная длина вопроса. */
export const CONSULT_QUESTION_MAX_LENGTH = 2000;

/** Текст фолбэка (§5.2 ШАГ 5) — вынесен, чтобы тесты и код не расходились. */
export const CONSULT_FALLBACK_ANSWER =
  'Хороший вопрос — точного ответа у меня пока нет. ' +
  'Я передал его администратору, он вернётся с ответом. ' +
  'Ответ придёт уведомлением, обычно в течение часа.';

/** Вопрос юзеру: продолжить с админом? */
export const CONSULT_CALL_ADMIN_HINT =
  'Хотите, я позову администратора — он ответит лично?';

/** Класс вопроса для поиска по базе знаний — фиксированные ключи. */
export const CONSULT_QUESTION_KINDS = [
  'EXACT',
  'TRGM',
  'KEYWORD',
  'PRODUCT',
  'NONE',
] as const;

export class AskConsultDto {
  @IsString()
  @MinLength(3, { message: 'text must be at least 3 characters' })
  @MaxLength(CONSULT_QUESTION_MAX_LENGTH, {
    message: `text must be at most ${CONSULT_QUESTION_MAX_LENGTH} characters`,
  })
  text: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  productId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  route?: string;
}

export class RateConsultDto {
  @IsBoolean()
  helpful: boolean;
}

export class CallAdminDto {
  @IsOptional()
  @IsString()
  @MinLength(3, { message: 'text must be at least 3 characters' })
  @MaxLength(CONSULT_QUESTION_MAX_LENGTH)
  text?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  feedbackId?: string;
}

/** Ответ POST /consult/ask (§5.2 ШАГ 6). */
export interface ConsultAnswer {
  answer: string;
  source: ConsultSource;
  confidence: number;
  knowledgeId?: string;
  feedbackId?: string;
  askAdmin: boolean;
  suggestions: string[];
  /** id записи лога — нужен для POST /consult/:logId/rate. */
  logId?: string;
}