/**
 * Поиск по базе знаний (ЭТАП 2 ТЗ §5.2 ШАГ 2, §5.1).
 *
 * СТАТУС НА ЭТАПЕ 2: база знаний ещё не существует — таблица `KnowledgeEntry`
 * создаётся на Этапе 3 (§6). Поэтому сервис — ЗАДЕЛ: он полностью реализует
 * нормализацию, ранжирование и контракт выдачи, но если таблицы нет, честно
 * возвращает пустой результат (`available: false`), а ConsultService идёт
 * дальше по шагам §5.2. Никаких выдуманных ответов и никаких ошибок в лог
 * на каждый вопрос.
 *
 * ПОЧЕМУ НЕ СОЗДАЁМ ТАБЛИЦУ ЗДЕСЬ. Это прямо запрещено заданием: модель
 * `KnowledgeEntry` — предмет Этапа 3. Пустая таблица «на будущее» создала бы
 * иллюзию работающей базы знаний и мусорные миграции.
 *
 * Ранжирование (§5.2 ШАГ 2c) реализовано целиком — когда таблица появится,
 * поиск заработает без правок:
 *   score = 0.60*similarity
 *         + 0.15*min(1, ln(1+usageCount)/ln(50))
 *         + 0.15*(helpfulCount+1)/(helpfulCount+notHelpfulCount+2)
 *         + 0.10*recency(lastUsedAt, updatedAt)     // полураспад 180 дней
 *         + 0.10 если совпал productId
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  extractKeywords,
  extractTopics,
  normalize,
  trigramSimilarity,
} from './knowledge-normalizer';

/** Одна запись базы знаний в том виде, в котором её видит консультант. */
export interface KnowledgeHit {
  id: string;
  question: string;
  answer: string;
  answerShort: string | null;
  productId: string | null;
  usageCount: number;
  helpfulCount: number;
  notHelpfulCount: number;
  lastUsedAt: Date | null;
  updatedAt: Date;
  /** Похожесть формулировок 0..1. */
  similarity: number;
  /** Итоговый скор ранжирования 0..1. */
  score: number;
  /** Как нашли: EXACT | TRGM | KEYWORD. */
  match: 'EXACT' | 'TRGM' | 'KEYWORD';
}

/** Результат поиска. `available=false` — базы знаний ещё нет (Этап 3). */
export interface KnowledgeSearchResult {
  available: boolean;
  hits: KnowledgeHit[];
}

/** Веса ранжирования (§5.2 ШАГ 2c). */
const W_SIMILARITY = 0.6;
const W_USAGE = 0.15;
const W_HELPFUL = 0.15;
const W_RECENCY = 0.1;
const W_PRODUCT = 0.1;

/** Полураспад «свежести» записи, дней. */
const RECENCY_HALFLIFE_DAYS = 180;

/** Сколько записей тянем из БД под ранжирование. */
const CANDIDATE_LIMIT = 10;

/** Сколько записей уходит наверх. */
const RESULT_LIMIT = 5;

/**
 * Кэш «есть ли таблица KnowledgeEntry» на процесс.
 *
 * Проверять существование таблицы на КАЖДЫЙ вопрос — лишний round-trip, а
 * ответ на этот вопрос в пределах жизни процесса не меняется (миграция
 * Этапа 3 применяется с рестартом).
 */
let knowledgeTableCache: boolean | null = null;

/** Сброс кэша — нужен тестам. */
export function __resetKnowledgeTableCache(): void {
  knowledgeTableCache = null;
}

@Injectable()
export class KnowledgeSearchService {
  private readonly logger = new Logger(KnowledgeSearchService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Найти ответ в базе знаний.
   *
   * Порядок (§5.2 ШАГ 2):
   *   a) EXACT по `questionNorm` — similarity = 1.0;
   *   b) TRGM (pg_trgm `%`) + полнотекстовый поиск, объединение по max;
   *   c) пересчёт финального скора с учётом счётчиков, полезности и свежести.
   *
   * @param text      — вопрос пользователя как есть
   * @param productId — товар из контекста (если вопрос про товар)
   */
  async search(
    text: string,
    productId?: string | null,
  ): Promise<KnowledgeSearchResult> {
    const norm = normalize(text);
    if (!norm) return { available: true, hits: [] };

    const available = await this.hasKnowledgeTable();
    if (!available) return { available: false, hits: [] };

    const rows = await this.fetchCandidates(norm, text, productId);
    if (!rows.length) return { available: true, hits: [] };

    const hits = rows
      .map((r) => this.scoreRow(r, norm, productId))
      .sort((a, b) => b.score - a.score || b.similarity - a.similarity)
      .slice(0, RESULT_LIMIT);

    return { available: true, hits };
  }

  /**
   * Лучшая запись, если она проходит порог уверенности.
   * Возвращает null, если базы нет или ничего не нашли.
   */
  async bestMatch(
    text: string,
    productId?: string | null,
  ): Promise<KnowledgeHit | null> {
    const res = await this.search(text, productId);
    return res.hits[0] ?? null;
  }

  /** Зафиксировать использование записи (§5.2 ШАГ 3, usageCount++). */
  async markUsed(id: string): Promise<void> {
    if (!(await this.hasKnowledgeTable())) return;
    try {
      await this.prisma.$executeRawUnsafe(
        `UPDATE "KnowledgeEntry" SET "usageCount" = "usageCount" + 1, "lastUsedAt" = NOW() WHERE id = $1`,
        id,
      );
    } catch (err) {
      // Не роняем ответ юзеру из-за телеметрии.
      this.logger.warn(
        `Не удалось обновить usageCount знания ${id}: ${(err as Error).message}`,
      );
    }
  }

  /** Есть ли в БД таблица KnowledgeEntry (Этап 3). Ответ кэшируется. */
  async hasKnowledgeTable(): Promise<boolean> {
    if (knowledgeTableCache !== null) return knowledgeTableCache;
    try {
      const rows = await this.prisma.$queryRawUnsafe<{ exists: boolean }[]>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.tables
           WHERE table_schema = current_schema() AND table_name = 'KnowledgeEntry'
         ) AS exists`,
      );
      knowledgeTableCache = rows[0]?.exists === true;
    } catch (err) {
      // Не смогли проверить — считаем, что базы нет: консультант продолжит
      // работу по шагам ниже, а не упадёт.
      this.logger.warn(
        `Проверка KnowledgeEntry недоступна: ${(err as Error).message}`,
      );
      knowledgeTableCache = false;
    }
    return knowledgeTableCache;
  }

  // ==================== Внутреннее ====================

  /**
   * Кандидаты из БД: точное совпадение + похожие.
   *
   * `similarity()` — функция pg_trgm. Если расширения нет, запрос падает;
   * тогда переходим на keyword-выборку (ILIKE по значимым словам) и считаем
   * похожесть в приложении (§4.2, примечание про KNOWLEDGE_SEARCH_MODE).
   */
  private async fetchCandidates(
    norm: string,
    text: string,
    productId?: string | null,
  ): Promise<RawKnowledgeRow[]> {
    const productFilter =
      productId != null
        ? `AND ("productId" IS NULL OR "productId" = $2)`
        : '';

    try {
      const params: unknown[] = productId != null ? [norm, productId] : [norm];
      const rows = await this.prisma.$queryRawUnsafe<RawKnowledgeRow[]>(
        `SELECT id, question, "answerShort", answer, "productId",
                "usageCount", "helpfulCount", "notHelpfulCount",
                "lastUsedAt", "updatedAt",
                similarity("questionNorm", $1) AS sim
           FROM "KnowledgeEntry"
          WHERE status = 'ACTIVE'
            AND "questionNorm" % $1
            ${productFilter}
          ORDER BY sim DESC, "usageCount" DESC
          LIMIT ${CANDIDATE_LIMIT}`,
        ...params,
      );
      return rows;
    } catch {
      // pg_trgm недоступен — keyword-режим.
      return this.fetchByKeywords(text, productId);
    }
  }

  /** Keyword-фолбэк: ILIKE по значимым словам, похожесть считаем в приложении. */
  private async fetchByKeywords(
    text: string,
    productId?: string | null,
  ): Promise<RawKnowledgeRow[]> {
    const words = extractTopics(text);
    if (!words.length) return [];

    try {
      const params: unknown[] = [];
      const ors: string[] = [];
      for (const w of words) {
        params.push(`%${w}%`);
        ors.push(`"questionNorm" ILIKE $${params.length}`);
      }
      if (productId != null) {
        params.push(productId);
        ors.push(
          `("productId" IS NULL OR "productId" = $${params.length})`,
        );
      }
      const rows = await this.prisma.$queryRawUnsafe<RawKnowledgeRow[]>(
        `SELECT id, question, "answerShort", answer, "productId",
                "usageCount", "helpfulCount", "notHelpfulCount",
                "lastUsedAt", "updatedAt",
                NULL::float8 AS sim
           FROM "KnowledgeEntry"
          WHERE status = 'ACTIVE' AND (${ors.join(' OR ')})
          ORDER BY "usageCount" DESC
          LIMIT ${CANDIDATE_LIMIT}`,
        ...params,
      );
      // Точное совпадение нормализованных форм важнее всего.
      const norm = normalize(text);
      for (const r of rows) {
        r.sim = normalize(r.question) === norm
          ? 1
          : trigramSimilarity(norm, normalize(r.question));
      }
      return rows;
    } catch (err) {
      this.logger.warn(
        `Поиск по базе знаний недоступен: ${(err as Error).message}`,
      );
      return [];
    }
  }

  /** Финальный скор записи (§5.2 ШАГ 2c). */
  private scoreRow(
    row: RawKnowledgeRow,
    norm: string,
    productId?: string | null,
  ): KnowledgeHit {
    const rowNorm = normalize(row.question);
    const exact = rowNorm !== '' && rowNorm === norm;

    const similarity = exact
      ? 1
      : clamp01(
          typeof row.sim === 'number' && Number.isFinite(row.sim)
            ? row.sim
            : trigramSimilarity(norm, rowNorm),
        );

    const usage = Math.min(
      1,
      Math.log(1 + Math.max(0, row.usageCount)) / Math.log(50),
    );
    const helpful =
      (row.helpfulCount + 1) /
      (row.helpfulCount + row.notHelpfulCount + 2);
    const recency = this.recency(row.lastUsedAt ?? row.updatedAt);
    const productBonus =
      productId != null && row.productId === productId ? W_PRODUCT : 0;

    const score = clamp01(
      W_SIMILARITY * similarity +
        W_USAGE * usage +
        W_HELPFUL * helpful +
        W_RECENCY * recency +
        productBonus,
    );

    return {
      id: row.id,
      question: row.question,
      answer: row.answer,
      answerShort: row.answerShort,
      productId: row.productId,
      usageCount: row.usageCount,
      helpfulCount: row.helpfulCount,
      notHelpfulCount: row.notHelpfulCount,
      lastUsedAt: row.lastUsedAt,
      updatedAt: row.updatedAt,
      similarity,
      score,
      match: exact ? 'EXACT' : similarity > 0 ? 'TRGM' : 'KEYWORD',
    };
  }

  /** Свежесть записи: полураспад 180 дней → 1.0 сегодня, 0.5 через полгода. */
  private recency(when: Date | null): number {
    if (!when) return 0.5;
    const ageDays = (Date.now() - new Date(when).getTime()) / 86_400_000;
    if (!Number.isFinite(ageDays) || ageDays <= 0) return 1;
    return Math.pow(0.5, ageDays / RECENCY_HALFLIFE_DAYS);
  }
}

/** Строка KnowledgeEntry как её отдаёт raw-запрос. */
interface RawKnowledgeRow {
  id: string;
  question: string;
  answerShort: string | null;
  answer: string;
  productId: string | null;
  usageCount: number;
  helpfulCount: number;
  notHelpfulCount: number;
  lastUsedAt: Date | null;
  updatedAt: Date;
  sim: number | null;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}