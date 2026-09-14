/**
 * База знаний консультанта (ЭТАП 3 ТЗ §6.1–§6.4).
 *
 * Что здесь:
 *   - CRUD знаний (§6.4 №17–21) с АВТОМАТИЧЕСКИМ пересчётом `questionNorm`
 *     при любой записи вопроса: это ключ поиска, руками его не заполняют;
 *   - дедупликация через pg_trgm (§6.3): похожее знание не дублируем, а
 *     отдаём 409 со ссылкой на существующее — фронт предложит «обновить»;
 *   - ПУТЬ A (§6.1): ответ админа в треде → `KnowledgeCandidate{PENDING}` →
 *     одобрение с ОТРЕДАКТИРОВАННОЙ формулировкой вопроса (FR-3.2) →
 *     `KnowledgeEntry{status:ACTIVE, source:ADMIN}`;
 *   - ПУТЬ C: подтверждённый юзером ответ ИИ → кандидат `REVIEW`;
 *   - устаревание (§6.3, FR-3.6): cron раз в сутки переводит неиспользуемые
 *     знания в STALE, а плохие (helpfulRatio < 0.3) — на ревью;
 *   - статистика (§6.4 №25) и предпросмотр поиска (§6.4 №26).

 * Чего здесь НЕТ: поиска (он в `KnowledgeSearchService` — тот умеет
 * ранжирование §5.2 и работает, как только таблица появилась) и вызовов LLM.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  PAGINATION_BULK_LIMIT,
  clampLimit,
  clampPage,
} from '../common/dto/pagination.dto';
import {
  KNOWLEDGE_DUPLICATE_SIMILARITY,
  KNOWLEDGE_STATUSES,
} from './dto/knowledge.dto';
import {
  KnowledgeHit,
  KnowledgeSearchService,
} from '../consult/knowledge-search.service';
import { normalize, trigramSimilarity } from '../consult/knowledge-normalizer';

/** Сколько записей отдаём в топах статистики. */
const TOP_LIMIT = 10;

/** Окно анализа фолбэков/попаданий в статистике. */
const STATS_WINDOW = 500;

/** Дефолт «сколько дней без использования → STALE» (§6.3). */
const DEFAULT_STALE_DAYS = 180;

/** Дефолт порога полезности, ниже которого знание уходит на ревью (§6.3). */
const DEFAULT_REVIEW_HELPFUL_RATIO = 0.3;

/** Минимум использований, чтобы судить о полезности знания. */
const MIN_USAGE_FOR_RATIO = 5;

/**
 * Кэш «доступен ли pg_trgm» на процесс.
 *
 * Проверять расширение на каждую запись знания — лишний round-trip, а ответ
 * в пределах жизни процесса не меняется (расширение ставится миграцией).
 */
let trgmCache: boolean | null = null;

/** Сброс кэша pg_trgm — нужен тестам (и после наката миграции в рантайме). */
export function __resetTrgmCache(): void {
  trgmCache = null;
}

/** Знание в том виде, в каком оно уходит наружу. */
export interface KnowledgeView {
  id: string;
  question: string;
  questionNorm: string;
  answer: string;
  answerShort: string | null;
  productId: string | null;
  tags: string[];
  category: string | null;
  source: string;
  status: string;
  createdById: string | null;
  sourceFeedbackId: string | null;
  usageCount: number;
  helpfulCount: number;
  notHelpfulCount: number;
  helpfulRatio: number;
  lastUsedAt: Date | null;
  reviewDueAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly search: KnowledgeSearchService,
  ) {}

  // ==================== CRUD (§6.4 №17–21) ==============================

  /**
   * Создать знание (§6.4 №18, ПУТЬ B).
   *
   * Дубли не плодим: если похожее знание уже есть (trgm > 0.75), отдаём 409
   * с id существующего — фронт предложит «обновить существующее» (§6.3).
   */
  async create(
    dto: {
      question: string;
      answer: string;
      answerShort?: string;
      category?: string;
      tags?: string[];
      productId?: string;
      source?: string;
    },
    adminId: string | null,
  ): Promise<KnowledgeView> {
    const question = dto.question.trim();
    const answer = dto.answer.trim();
    const questionNorm = normalize(question);
    if (!questionNorm) {
      throw new BadRequestException(
        'question содержит только стоп-слова — сформулируйте иначе',
      );
    }

    const duplicate = await this.findDuplicate(questionNorm);
    if (duplicate) {
      throw new ConflictException({
        message: 'Похожее знание уже есть — обновите существующее',
        duplicateId: duplicate.id,
        similarity: duplicate.similarity,
      });
    }

    const created = await this.prisma.knowledgeEntry.create({
      data: {
        question,
        questionNorm,
        answer,
        answerShort: dto.answerShort?.trim() || null,
        category: dto.category?.trim() || null,
        tags: dto.tags ?? [],
        productId: dto.productId?.trim() || null,
        source: dto.source ?? 'ADMIN',
        status: 'ACTIVE',
        createdById: adminId,
      },
    });

    return this.toView(created);
  }

  /** Список знаний с фильтрами (§6.4 №17). */
  async list(params: {
    status?: string;
    category?: string;
    productId?: string;
    q?: string;
    page?: number;
    limit?: number;
  }) {
    const page = clampPage(params.page, 1);
    const limit = clampLimit(params.limit, PAGINATION_BULK_LIMIT);

    const where: Prisma.KnowledgeEntryWhereInput = {};
    if (params.status) where.status = params.status;
    if (params.category) where.category = params.category;
    if (params.productId) where.productId = params.productId;
    if (params.q?.trim()) {
      const q = params.q.trim();
      where.OR = [
        { question: { contains: q, mode: 'insensitive' } },
        { answer: { contains: q, mode: 'insensitive' } },
        { questionNorm: { contains: normalize(q), mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.knowledgeEntry.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.knowledgeEntry.count({ where }),
    ]);

    return {
      items: items.map((i) => this.toView(i)),
      total,
      page,
      limit,
    };
  }

  /** Одно знание. Нет — 404. */
  async getById(id: string): Promise<KnowledgeView> {
    const row = await this.prisma.knowledgeEntry.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Знание не найдено');
    return this.toView(row);
  }

  /**
   * Правка знания (§6.4 №19).
   *
   * Смена формулировки вопроса ОБЯЗАТЕЛЬНО пересчитывает `questionNorm`:
   * иначе поиск продолжил бы искать по старому ключу и правка была бы
   * невидимой (классический баг «поменял вопрос — не находится»).
   */
  async update(
    id: string,
    dto: {
      question?: string;
      answer?: string;
      answerShort?: string;
      category?: string;
      tags?: string[];
      productId?: string;
    },
  ): Promise<KnowledgeView> {
    const before = await this.prisma.knowledgeEntry.findUnique({
      where: { id },
    });
    if (!before) throw new NotFoundException('Знание не найдено');

    const data: Prisma.KnowledgeEntryUpdateInput = {};
    if (dto.question !== undefined) {
      const question = dto.question.trim();
      const questionNorm = normalize(question);
      if (!questionNorm) {
        throw new BadRequestException(
          'question содержит только стоп-слова — сформулируйте иначе',
        );
      }
      // Проверяем дубль только если формулировка реально изменилась.
      if (questionNorm !== before.questionNorm) {
        const duplicate = await this.findDuplicate(questionNorm, id);
        if (duplicate) {
          throw new ConflictException({
            message: 'Похожее знание уже есть — обновите существующее',
            duplicateId: duplicate.id,
            similarity: duplicate.similarity,
          });
        }
      }
      data.question = question;
      data.questionNorm = questionNorm;
    }
    if (dto.answer !== undefined) data.answer = dto.answer.trim();
    if (dto.answerShort !== undefined) {
      data.answerShort = dto.answerShort.trim() || null;
    }
    if (dto.category !== undefined) data.category = dto.category.trim() || null;
    if (dto.tags !== undefined) data.tags = dto.tags;
    if (dto.productId !== undefined) {
      data.productId = dto.productId.trim() || null;
    }

    const updated = await this.prisma.knowledgeEntry.update({
      where: { id },
      data,
    });
    return this.toView(updated);
  }

  /**
   * Удаление знания (§6.4 №20) — МЯГКОЕ.
   *
   * Физическое удаление запрещено осознанно: `ConsultLog.knowledgeId` и
   * `KnowledgeCandidate.knowledgeEntryId` ссылаются на запись, а история
   * ответов (каким знанием ответили юзеру) нужна для разбора качества.
   */
  async archive(id: string): Promise<KnowledgeView> {
    return this.setStatus(id, 'ARCHIVED');
  }

  /** Смена статуса знания (§6.4 №21). */
  async setStatus(id: string, status: string): Promise<KnowledgeView> {
    if (!(KNOWLEDGE_STATUSES as readonly string[]).includes(status)) {
      throw new BadRequestException(
        `status must be one of: ${KNOWLEDGE_STATUSES.join(', ')}`,
      );
    }
    const exists = await this.prisma.knowledgeEntry.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Знание не найдено');

    const updated = await this.prisma.knowledgeEntry.update({
      where: { id },
      data: { status },
    });
    return this.toView(updated);
  }

  // ==================== Кандидаты (§6.1) ================================

  /**
   * ПУТЬ A: ответ админа в треде → черновик знания.
   *
   * Вызывается из `FeedbackService.postAdminMessage` (kind=TEXT). Ошибки
   * здесь НЕ должны ронять отправку сообщения: сообщение админа уже записано
   * и доставлено юзеру, а кандидат — вторичная (хоть и важная) сущность.
   * Поэтому все исключения глушатся с warning'ом.
   *
   * @param questionDraft — вопрос юзера, на который отвечали (плохой ключ,
   *                        поэтому админ его отредактирует при одобрении)
   */
  async createCandidateFromAdminMessage(input: {
    feedbackId: string;
    messageId: string;
    questionDraft: string;
    answerDraft: string;
    createdById: string | null;
    /** REVIEW — кандидат из подтверждённого ответа ИИ (ПУТЬ C). */
    status?: string;
  }): Promise<{ id: string; status: string } | null> {
    try {
      const existing = await this.prisma.knowledgeCandidate.findUnique({
        where: { messageId: input.messageId },
        select: { id: true, status: true },
      });
      // Идемпотентность: повторный вызов на то же сообщение не плодит дубль.
      if (existing) return { id: existing.id, status: existing.status };

      const created = await this.prisma.knowledgeCandidate.create({
        data: {
          feedbackId: input.feedbackId,
          messageId: input.messageId,
          questionDraft: input.questionDraft.trim(),
          answerDraft: input.answerDraft.trim(),
          status: input.status ?? 'PENDING',
          createdById: input.createdById,
        },
      });
      return { id: created.id, status: created.status };
    } catch (err) {
      this.logger.warn(
        `Кандидат в базу знаний не создан (тред ${input.feedbackId}): ${(err as Error).message}`,
      );
      return null;
    }
  }

  /** Список кандидатов (§6.4 №22) со связанными тредами. */
  async listCandidates(params: {
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const page = clampPage(params.page, 1);
    const limit = clampLimit(params.limit, PAGINATION_BULK_LIMIT);

    const where: Prisma.KnowledgeCandidateWhereInput = {};
    // Без фильтра показываем только то, что ждёт решения админа.
    where.status = params.status ?? { in: ['PENDING', 'REVIEW'] };

    const [items, total] = await Promise.all([
      this.prisma.knowledgeCandidate.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.knowledgeCandidate.count({ where }),
    ]);

    // Подтягиваем треды одним запросом: в списке нужна тема обращения.
    const feedbackIds = Array.from(new Set(items.map((i) => i.feedbackId)));
    const threads = feedbackIds.length
      ? await this.prisma.feedback.findMany({
          where: { id: { in: feedbackIds } },
          select: {
            id: true,
            subject: true,
            type: true,
            status: true,
            userId: true,
          },
        })
      : [];
    const threadById = new Map(threads.map((t) => [t.id, t]));

    return {
      items: items.map((c) => ({
        ...c,
        feedback: threadById.get(c.feedbackId) ?? null,
      })),
      total,
      page,
      limit,
    };
  }

  /**
   * Принять кандидата (§6.4 №23, ПУТЬ A).
   *
   * `question` из тела — ОТРЕДАКТИРОВАННАЯ админом формулировка (FR-3.2).
   * Если админ её не прислал — берём `questionDraft` как есть (вопрос юзера).
   * `mergeInto` — слияние с существующим знанием вместо создания нового.
   */
  async approveCandidate(
    candidateId: string,
    dto: {
      question?: string;
      answer?: string;
      answerShort?: string;
      category?: string;
      tags?: string[];
      productId?: string;
      mergeInto?: string;
    },
    adminId: string | null,
  ): Promise<{ candidate: { id: string; status: string }; knowledge: KnowledgeView }> {
    const candidate = await this.prisma.knowledgeCandidate.findUnique({
      where: { id: candidateId },
    });
    if (!candidate) throw new NotFoundException('Кандидат не найден');
    if (candidate.status === 'ACCEPTED') {
      throw new BadRequestException('Кандидат уже принят');
    }
    if (candidate.status === 'REJECTED') {
      throw new BadRequestException('Кандидат отклонён');
    }

    const question = (dto.question ?? candidate.questionDraft).trim();
    const answer = (dto.answer ?? candidate.answerDraft).trim();
    const questionNorm = normalize(question);
    if (!questionNorm) {
      throw new BadRequestException(
        'Формулировка вопроса пуста — задайте нормальный вопрос',
      );
    }

    let knowledge: KnowledgeView;
    if (dto.mergeInto) {
      // Слияние: обновляем существующее знание, дубль не создаём.
      knowledge = await this.update(dto.mergeInto, {
        question,
        answer,
        answerShort: dto.answerShort,
        category: dto.category,
        tags: dto.tags,
        productId: dto.productId,
      });
    } else {
      // Дедупликация мягкая: если знание уже есть, сливаем в него, а не падаем.
      const duplicate = await this.findDuplicate(questionNorm);
      if (duplicate) {
        knowledge = await this.update(duplicate.id, {
          question,
          answer,
          answerShort: dto.answerShort,
          category: dto.category,
          tags: dto.tags,
          productId: dto.productId,
        });
      } else {
        const created = await this.prisma.knowledgeEntry.create({
          data: {
            question,
            questionNorm,
            answer,
            answerShort: dto.answerShort?.trim() || null,
            category: dto.category?.trim() || null,
            tags: dto.tags ?? [],
            productId: dto.productId?.trim() || null,
            // ПУТЬ C приходит как REVIEW-кандидат из ответа ИИ.
            source: candidate.status === 'REVIEW' ? 'AI_APPROVED' : 'ADMIN',
            status: 'ACTIVE',
            createdById: adminId,
            sourceFeedbackId: candidate.feedbackId,
          },
        });
        knowledge = this.toView(created);
      }
    }

    const updatedCandidate = await this.prisma.knowledgeCandidate.update({
      where: { id: candidateId },
      data: { status: 'ACCEPTED', knowledgeEntryId: knowledge.id },
    });

    // Фиксируем факт в треде (kind=KNOWLEDGE): видно, какое знание родилось
    // из какой переписки. Пишем напрямую в FeedbackMessage, а не через
    // FeedbackService: обратная зависимость сервисов дала бы цикл модулей
    // (FeedbackService уже держит KnowledgeService ради ПУТИ A).
    // Флаги прочтения выставлены сразу — это служебная запись, счётчики
    // непрочитанного она двигать не должна.
    try {
      await this.prisma.feedbackMessage.create({
        data: {
          feedbackId: candidate.feedbackId,
          authorId: null,
          authorRole: 'SYSTEM',
          body: 'Ответ сохранён в базу знаний консультанта.',
          kind: 'KNOWLEDGE',
          meta: {
            knowledgeEntryId: knowledge.id,
            candidateId: candidate.id,
            question: knowledge.question,
          },
          isReadByUser: true,
          isReadByAdmin: true,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Сообщение о знании не записано в тред ${candidate.feedbackId}: ${(err as Error).message}`,
      );
    }

    return {
      candidate: { id: updatedCandidate.id, status: updatedCandidate.status },
      knowledge,
    };
  }

  /** Отклонить кандидата (§6.4 №24). */
  async rejectCandidate(candidateId: string) {
    const candidate = await this.prisma.knowledgeCandidate.findUnique({
      where: { id: candidateId },
    });
    if (!candidate) throw new NotFoundException('Кандидат не найден');
    if (candidate.status === 'ACCEPTED') {
      throw new BadRequestException('Кандидат уже принят — отклонять нечего');
    }
    const updated = await this.prisma.knowledgeCandidate.update({
      where: { id: candidateId },
      data: { status: 'REJECTED' },
    });
    return { id: updated.id, status: updated.status };
  }

  // ==================== Поиск и предпросмотр ============================

  /**
   * Предпросмотр поиска (§6.4 №26) — «что найдёт по этому вопросу».
   *
   * Нужен владельцу для настройки порогов: видно и скор, и из чего он
   * сложился, и в какую ветку §5.2 попадёт вопрос.
   */
  async searchPreview(text: string, productId?: string | null) {
    const res = await this.search.search(text, productId ?? null);
    const confidence = res.hits[0]?.score ?? 0;
    const confidenceThreshold = await this.search.confidenceThreshold();

    let branch: 'KNOWLEDGE' | 'RAG_LITE' | 'LLM' = 'LLM';
    if (res.available && confidence >= confidenceThreshold) branch = 'KNOWLEDGE';
    else if (confidence >= (await this.search.hintThreshold())) branch = 'RAG_LITE';

    return {
      available: res.available,
      normalized: normalize(text),
      branch,
      confidence,
      confidenceThreshold,
      hits: res.hits.map((h: KnowledgeHit) => ({
        id: h.id,
        question: h.question,
        answer: h.answerShort?.trim() || h.answer,
        similarity: Number(h.similarity.toFixed(4)),
        score: Number(h.score.toFixed(4)),
        match: h.match,
        usageCount: h.usageCount,
      })),
    };
  }

  // ==================== Статистика (§6.4 №25) ===========================

  /**
   * Сводка по базе знаний.
   *
   * `topFalledBack` — главный практический отчёт: вопросы, на которые база
   * не ответила. Это готовый список того, что надо задокументировать (§6.3).
   */
  async getStats() {
    const [total, active, stale, review, archived, candidatesPending] =
      await Promise.all([
        this.prisma.knowledgeEntry.count(),
        this.prisma.knowledgeEntry.count({ where: { status: 'ACTIVE' } }),
        this.prisma.knowledgeEntry.count({ where: { status: 'STALE' } }),
        this.prisma.knowledgeEntry.count({ where: { status: 'REVIEW' } }),
        this.prisma.knowledgeEntry.count({ where: { status: 'ARCHIVED' } }),
        this.prisma.knowledgeCandidate.count({
          where: { status: { in: ['PENDING', 'REVIEW'] } },
        }),
      ]);

    const topUsed = await this.prisma.knowledgeEntry.findMany({
      where: { usageCount: { gt: 0 } },
      orderBy: [{ usageCount: 'desc' }, { id: 'desc' }],
      take: TOP_LIMIT,
      select: {
        id: true,
        question: true,
        usageCount: true,
        helpfulCount: true,
        notHelpfulCount: true,
      },
    });

    // Окно последних ответов консультанта: по нему считаем долю попаданий в
    // базу знаний и топ вопросов без ответа.
    const logs = await this.prisma.consultLog.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: STATS_WINDOW,
      select: { question: true, source: true },
    });

    const fallbackCounts = new Map<string, { question: string; count: number }>();
    let knowledgeHits = 0;
    for (const log of logs) {
      if (log.source === 'KNOWLEDGE') knowledgeHits += 1;
      if (log.source !== 'FALLBACK') continue;
      const key = normalize(log.question) || log.question.toLowerCase();
      const cur = fallbackCounts.get(key);
      if (cur) cur.count += 1;
      else fallbackCounts.set(key, { question: log.question, count: 1 });
    }

    const topFalledBack = Array.from(fallbackCounts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, TOP_LIMIT);

    const knowledgeHitRate = logs.length
      ? Math.round((knowledgeHits / logs.length) * 1000) / 10
      : 0;

    const threadStats = await this.feedbackStats();

    return {
      total,
      active,
      stale,
      review,
      archived,
      candidatesPending,
      topUsed: topUsed.map((t) => ({
        ...t,
        helpfulRatio: this.helpfulRatio(t),
      })),
      topFalledBack,
      knowledgeHitRate,
      aiResolvedPercent: threadStats.aiResolvedPercent,
      avgResponseMin: threadStats.avgFirstResponseMin,
    };
  }

  /**
   * Тредовые метрики для сводки.
   *
   * Считаются здесь, а не вызовом `FeedbackService.getStats()`: это связало бы
   * модули в цикл (FeedbackService уже держит KnowledgeService ради кандидатов).
   * Определение «ИИ закрыл сам» намеренно то же, что в `getStats` треда.
   */
  private async feedbackStats(): Promise<{
    aiResolvedPercent: number;
    avgFirstResponseMin: number;
  }> {
    const threads = await this.prisma.feedback.findMany({
      orderBy: { createdAt: 'desc' },
      take: STATS_WINDOW,
      select: {
        id: true,
        createdAt: true,
        status: true,
        messages: {
          select: { authorRole: true, kind: true, createdAt: true },
        },
      },
    });

    let firstResponseSumMs = 0;
    let firstResponseCount = 0;
    let aiResolved = 0;

    for (const t of threads) {
      const adminMsg = t.messages
        .filter((m) => m.authorRole === 'ADMIN' && m.kind !== 'NOTE')
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];

      if (adminMsg) {
        firstResponseSumMs +=
          adminMsg.createdAt.getTime() - t.createdAt.getTime();
        firstResponseCount += 1;
      } else if (
        t.status === 'AI_HANDLED' ||
        t.messages.some((m) => m.kind === 'AI_ANSWER')
      ) {
        aiResolved += 1;
      }
    }

    return {
      avgFirstResponseMin: firstResponseCount
        ? Math.round(firstResponseSumMs / firstResponseCount / 60000)
        : 0,
      aiResolvedPercent: threads.length
        ? Math.round((aiResolved / threads.length) * 1000) / 10
        : 0,
    };
  }

  /**
   * FR-3.6 / §6.3: раз в сутки чистим базу от балласта.
   *
   *   ACTIVE + lastUsedAt < now-N дней И usageCount=0  → STALE
   *   ACTIVE + helpfulRatio < 0.3 при usageCount >= 5  → REVIEW (+ уведомить)
   *
   * Ничего не удаляем физически: знание можно вернуть в ACTIVE одной кнопкой.
   */
  @Cron('0 4 * * *')
  async runMaintenance(): Promise<{ staled: number; review: number }> {
    try {
      const staleDays = await this.intSetting(
        'knowledge_stale_days',
        DEFAULT_STALE_DAYS,
      );
      const ratioFloor = await this.floatSetting(
        'knowledge_review_helpful_ratio',
        DEFAULT_REVIEW_HELPFUL_RATIO,
      );
      const cutoff = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000);

      const staled = await this.prisma.knowledgeEntry.updateMany({
        where: {
          status: 'ACTIVE',
          usageCount: 0,
          lastUsedAt: null,
          createdAt: { lt: cutoff },
        },
        data: { status: 'STALE' },
      });

      // Плохие знания ищем в приложении: helpfulRatio — вычисляемое выражение,
      // а записей в базе знаний тысячи, не миллионы (§6.2).
      const used = await this.prisma.knowledgeEntry.findMany({
        where: { status: 'ACTIVE', usageCount: { gte: MIN_USAGE_FOR_RATIO } },
        select: {
          id: true,
          question: true,
          helpfulCount: true,
          notHelpfulCount: true,
        },
      });
      const bad = used.filter((e) => this.helpfulRatio(e) < ratioFloor);

      if (bad.length) {
        await this.prisma.knowledgeEntry.updateMany({
          where: { id: { in: bad.map((b) => b.id) } },
          data: { status: 'REVIEW', reviewDueAt: new Date() },
        });
        this.logger.warn(
          `База знаний: ${bad.length} записей ушли на ревью ` +
            `(helpfulRatio < ${ratioFloor}): ${bad
              .slice(0, 5)
              .map((b) => b.question)
              .join(' | ')}`,
        );
      }

      if (staled.count) {
        this.logger.log(`База знаний: ${staled.count} записей переведены в STALE`);
      }
      return { staled: staled.count, review: bad.length };
    } catch (err) {
      this.logger.warn(`Обслуживание базы знаний упало: ${(err as Error).message}`);
      return { staled: 0, review: 0 };
    }
  }

  // ==================== Внутреннее ======================================

  /**
   * Похожее знание (§6.3, дедупликация trgm > 0.75).
   *
   * Если pg_trgm недоступен — считаем триграммы в приложении по активным
   * записям (на 1–5k записей это единицы миллисекунд).
   */
  private async findDuplicate(
    questionNorm: string,
    excludeId?: string,
  ): Promise<{ id: string; similarity: number } | null> {
    if (await this.hasTrgm()) {
      try {
        const rows = await this.prisma.$queryRawUnsafe<
          { id: string; sim: number }[]
        >(
          `SELECT id, similarity("questionNorm", $1) AS sim
             FROM "KnowledgeEntry"
            WHERE status <> 'ARCHIVED'
              AND "questionNorm" % $1
              ${excludeId ? 'AND id <> $2' : ''}
            ORDER BY sim DESC
            LIMIT 1`,
          ...(excludeId ? [questionNorm, excludeId] : [questionNorm]),
        );
        const best = rows[0];
        if (best && best.sim >= KNOWLEDGE_DUPLICATE_SIMILARITY) {
          return { id: best.id, similarity: best.sim };
        }
        return null;
      } catch (err) {
        this.logger.warn(
          `Проверка дублей через pg_trgm не удалась, считаю в приложении: ${(err as Error).message}`,
        );
        trgmCache = false;
      }
    }

    const rows = await this.prisma.knowledgeEntry.findMany({
      where: {
        status: { not: 'ARCHIVED' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true, questionNorm: true },
    });
    let best: { id: string; similarity: number } | null = null;
    for (const r of rows) {
      const sim = trigramSimilarity(questionNorm, r.questionNorm);
      if (sim >= KNOWLEDGE_DUPLICATE_SIMILARITY && (!best || sim > best.similarity)) {
        best = { id: r.id, similarity: sim };
      }
    }
    return best;
  }

  /** Есть ли расширение pg_trgm (ответ кэшируется на процесс). */
  private async hasTrgm(): Promise<boolean> {
    if (trgmCache !== null) return trgmCache;
    try {
      const rows = await this.prisma.$queryRawUnsafe<{ ok: boolean }[]>(
        `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') AS ok`,
      );
      trgmCache = rows[0]?.ok === true;
    } catch (err) {
      this.logger.warn(
        `Проверка pg_trgm недоступна: ${(err as Error).message}`,
      );
      trgmCache = false;
    }
    return trgmCache;
  }

  /** (helpful + 1) / (helpful + notHelpful + 2) — сглаживание Лапласа (§6.3). */
  private helpfulRatio(e: {
    helpfulCount: number;
    notHelpfulCount: number;
  }): number {
    const ratio =
      (e.helpfulCount + 1) / (e.helpfulCount + e.notHelpfulCount + 2);
    return Math.round(ratio * 1000) / 1000;
  }

  private async intSetting(key: string, def: number): Promise<number> {
    const rows = await this.prisma.setting.findUnique({ where: { key } });
    const raw = rows?.value;
    if (raw == null || raw === '') return def;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : def;
  }

  private async floatSetting(key: string, def: number): Promise<number> {
    const rows = await this.prisma.setting.findUnique({ where: { key } });
    const raw = rows?.value;
    if (raw == null || raw === '') return def;
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) ? n : def;
  }

  private toView(row: {
    id: string;
    question: string;
    questionNorm: string;
    answer: string;
    answerShort: string | null;
    productId: string | null;
    tags: string[];
    category: string | null;
    source: string;
    status: string;
    createdById: string | null;
    sourceFeedbackId: string | null;
    usageCount: number;
    helpfulCount: number;
    notHelpfulCount: number;
    lastUsedAt: Date | null;
    reviewDueAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): KnowledgeView {
    return { ...row, helpfulRatio: this.helpfulRatio(row) };
  }
}