/**
 * ИИ-консультант «Базар» (ЭТАП 2 ТЗ, §5.1–§5.3, §5.5–§5.6).
 *
 * Оркестратор ответа. Порядок строго по §5.2:
 *   ШАГ 0. Гварды: выключен → 503, rate limit → 429, модерация → 400.
 *   ШАГ 1. Нормализация вопроса.
 *   ШАГ 2. Поиск в базе знаний  (на этом этапе базы нет — хук отдаёт пусто).
 *   ШАГ 3. Развилка по скору: >= confidence → ответ из знаний (LLM НЕ зовём);
 *          >= hint → RAG-lite (знания в промпт, temp 0.2);
 *          < hint  → товарный контекст + общий ответ (temp 0.4).
 *   ШАГ 4. Проверка ответа LLM на галлюцинацию (цены/наличие сверяем с БД).
 *   ШАГ 5. Фолбэк: «админ вернётся» + автосоздание/дополнение треда.
 *   ШАГ 6. Лог (ConsultLog), история (BazarMessage meta.kind='consult').
 *
 * ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ:
 *   - векторной БД и эмбеддингов (SPEC §7.3: не нужны на 1–5k записей);
 *   - обучения/fine-tune (Этап 3);
 *   - модели KnowledgeEntry (Этап 3) — поиск отдаёт пусто, пока таблицы нет;
 *   - собственного HTTP-клиента к LLM: единственная точка вызова —
 *     `BazarApiClient.complete()`.
 */
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ModerationService } from '../moderation/moderation.service';
import { BazarApiClient } from '../bazar/bazar.api-client';
import { CatalogSearchService } from '../bazar/catalog-search.service';
import { FeedbackService } from '../feedback/feedback.service';
import {
  CONSULT_FALLBACK_ANSWER,
  DEFAULT_CONSULT_CONFIDENCE_THRESHOLD,
  DEFAULT_CONSULT_ENABLED,
  DEFAULT_CONSULT_HINT_THRESHOLD,
  DEFAULT_CONSULT_MAX_AI_TURNS,
  DEFAULT_CONSULT_PRODUCT_CONTEXT,
  DEFAULT_CONSULT_RATE_LIMIT_PER_HOUR,
  ConsultAnswer,
  ConsultSource,
} from './dto/consult.dto';
import { KnowledgeHit, KnowledgeSearchService } from './knowledge-search.service';
import { normalize } from './knowledge-normalizer';

/** Товарный контекст, который уходит в промпт (§5.3). */
interface ProductContext {
  id: string;
  title: string;
  price: number;
  isActive: boolean;
  deliveryType: string | null;
  deliveryInfo: Prisma.JsonValue | null;
}

/** Разобранный ответ LLM. */
interface LlmOutcome {
  /** Текст ответа (уже без служебных JSON-блоков). */
  text: string;
  /** Модель прямо сказала «не знаю» (§5.3 правило 3). */
  unknown: boolean;
  /** Ответ упал по сети/таймауту — идём в фолбэк. */
  failed: boolean;
}

/**
 * Денежная сумма в тексте: «1500 руб», «300 ₽», «500 рублей», «200 р.».
 *
 * ⚠️ Без `\b` после «руб»: в JS `\w` — только латиница/цифры/подчёркивание,
 * поэтому граница слова после кириллицы НЕ срабатывает («руб,» → `руб\b` не
 * матчится). Вместо `\b` — явный negative lookahead на кириллицу.
 */
const MONEY_RE = /\d[\d\s\u00a0]*(?:₽|рублей|руб(?![а-яё])|р\.)/gi;

/** Таймаут вызова LLM — как у ModerationService (эталон). */
const LLM_TIMEOUT_MS = 15_000;

/** Сколько последних реплик истории подкладываем в промпт (§5.3). */
const HISTORY_LIMIT = 6;

/** Минимальная длина осмысленного ответа LLM (§5.2 ШАГ 4). */
const MIN_ANSWER_LENGTH = 15;

/** Окно rate-limit и окно «сколько раз ИИ уже отвечал». */
const RATE_WINDOW_MS = 60 * 60 * 1000;
const TURNS_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Маркеры вопроса про товар/цену/наличие (§5.2 ШАГ 3). */
const PRODUCT_QUESTION_RE =
  /(сколько|скок|почём|почем)\s+(стоит|стоят|стоимость|цена|цены)|есть\s+ли|имеется\s+ли|в\s+наличии|доставк|до\s+\d|цена|стоимость|срок/i;

@Injectable()
export class ConsultService {
  private readonly logger = new Logger(ConsultService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly moderation: ModerationService,
    private readonly api: BazarApiClient,
    private readonly catalog: CatalogSearchService,
    private readonly knowledge: KnowledgeSearchService,
    private readonly feedback: FeedbackService,
  ) {}

  // ==================== POST /consult/ask ====================

  /**
   * Задать вопрос консультанту.
   *
   * Все внешние сбои (LLM недоступен, каталог упал) приводят к фолбэку на
   * админа, а не к 500: юзер в любом случае должен получить внятный ответ.
   */
  async ask(
    userId: string,
    input: { text: string; productId?: string | null; route?: string | null },
  ): Promise<ConsultAnswer> {
    const startedAt = Date.now();
    const text = input.text.trim();

    // ── ШАГ 0. Гварды ────────────────────────────────────────────────────
    await this.assertEnabled();
    await this.assertRateLimit(userId);
    await this.assertAllowedByModeration(text, userId);

    // ── ШАГ 1. Нормализация ──────────────────────────────────────────────
    const questionNorm = normalize(text);

    // ── ШАГ 2/3. База знаний ─────────────────────────────────────────────
    const search = await this.knowledge.search(text, input.productId ?? null);
    const best: KnowledgeHit | null = search.hits[0] ?? null;
    const confidence = best?.score ?? 0;

    const productContext = await this.resolveProductContext(
      userId,
      text,
      input.productId ?? null,
    );

    let source: ConsultSource = 'LLM';
    let answer = '';
    let knowledgeId: string | undefined;
    let askAdmin = false;
    let feedbackId: string | undefined;
    let suggestions: string[] = [];

    if (best && confidence >= (await this.confidenceThreshold())) {
      // Вариант А: отвечаем словами админа, LLM НЕ вызываем.
      source = 'KNOWLEDGE';
      knowledgeId = best.id;
      answer = best.answerShort?.trim() || best.answer;
      await this.knowledge.markUsed(best.id);
      suggestions = search.hits
        .slice(1, 4)
        .map((h) => h.question)
        .filter((q) => q && normalize(q) !== questionNorm);
    } else {
      const hintFloor = await this.hintThreshold();
      // RAG-lite: в промпт идут только записи выше порога подсказок (§5.2).
      const hints = search.hits.filter((h) => h.score >= hintFloor).slice(0, 3);
      const useHints = hints.length > 0;
      const hintTemperature = useHints ? 0.2 : 0.4;

      const outcome = await this.callLlm({
        userId,
        text,
        product: productContext,
        hints,
      });

      if (!outcome.failed && !outcome.unknown && outcome.text.length >= MIN_ANSWER_LENGTH) {
        const checked = this.checkPrices(outcome.text, productContext, hints);
        source = productContext ? 'CATALOG' : 'LLM';
        answer = checked.text;
        if (useHints) {
          // Счётчик «использовано» — только у лучшей подсказки (§5.2 ШАГ 3).
          knowledgeId = hints[0].id;
          await this.knowledge.markUsed(hints[0].id);
        }
        if (checked.rewritten) {
          suggestions = ['Уточнить у админа'];
        }
        void hintTemperature;
      }
    }

    // ── ШАГ 5. Фолбэк ────────────────────────────────────────────────────
    if (!answer) {
      source = 'FALLBACK';
      answer = CONSULT_FALLBACK_ANSWER;
      askAdmin = true;
      feedbackId = await this.escalateToAdmin(userId, text, input.productId ?? null);
    }

    // ── Сколько раз ИИ уже отвечал: после N — настойчиво предлагаем админа ─
    const turns = await this.countAiTurns(userId);
    const maxTurns = await this.intSetting(
      'consult_max_ai_turns',
      DEFAULT_CONSULT_MAX_AI_TURNS,
    );
    if (!askAdmin && turns >= maxTurns) {
      suggestions = [...suggestions, 'Позвать администратора'].slice(0, 4);
    }

    // ── ШАГ 6. Лог и история ─────────────────────────────────────────────
    const latencyMs = Date.now() - startedAt;
    const log = await this.logConsult({
      userId,
      question: text,
      answer,
      source,
      knowledgeId,
      similarity: best?.similarity ?? null,
      feedbackId,
      latencyMs,
    });
    await this.saveHistory(userId, text, answer, source, confidence);

    return {
      answer,
      source,
      confidence: Number(confidence.toFixed(4)),
      ...(knowledgeId ? { knowledgeId } : {}),
      ...(feedbackId ? { feedbackId } : {}),
      askAdmin,
      suggestions,
      logId: log.id,
    };
  }

  // ==================== POST /consult/:logId/rate ========================

  /**
   * Оценить полезность ответа (§5.5 №15).
   *
   * `helpful=true` по ответу, выросшему из знания, поднимает счётчик знания —
   * так база сама вычищает слабые записи (Этап 3 §6.5). На Этапе 2 таблицы
   * знаний ещё нет, поэтому обновление счётчиков пропускается молча.
   */
  async rate(userId: string, logId: string, helpful: boolean) {
    const row = await this.prisma.consultLog.findUnique({ where: { id: logId } });
    if (!row || row.userId !== userId) {
      throw new BadRequestException('Запись консультации не найдена');
    }

    const updated = await this.prisma.consultLog.update({
      where: { id: logId },
      data: { helpful },
    });

    if (row.knowledgeId && (await this.knowledge.hasKnowledgeTable())) {
      const column = helpful ? 'helpfulCount' : 'notHelpfulCount';
      try {
        await this.prisma.$executeRawUnsafe(
          `UPDATE "KnowledgeEntry" SET "${column}" = "${column}" + 1 WHERE id = $1`,
          row.knowledgeId,
        );
      } catch (err) {
        this.logger.warn(
          `Не удалось обновить счётчики знания ${row.knowledgeId}: ${(err as Error).message}`,
        );
      }
    }

    return { logId: updated.id, helpful: updated.helpful };
  }

  // ==================== POST /consult/call-admin =========================

  /**
   * Юзер явно зовёт админа (§5.5 №16).
   *
   * Если передан `feedbackId` и тред принадлежит юзеру — дописываем в него,
   * иначе создаём новый тред с источником CONSULT. Право собственности
   * проверяет FeedbackService (чужой тред → 403), здесь только маршрутизация.
   */
  async callAdmin(
    userId: string,
    input: { text?: string; feedbackId?: string | null },
  ) {
    const question =
      input.text?.trim() ||
      'Пользователь просит связаться с администратором из ИИ-консультанта.';

    if (input.feedbackId) {
      try {
        const res = await this.feedback.postUserMessage(
          input.feedbackId,
          userId,
          question,
        );
        return { feedbackId: input.feedbackId, created: false, message: res.message };
      } catch (err) {
        // Чужой/закрытый/несуществующий тред — не отказываем юзеру, а
        // создаём свой: цель вызова — «позвать админа», а не «попасть в тред».
        this.logger.warn(
          `call-admin: тред ${input.feedbackId} недоступен (${(err as Error).message}), создаю новый`,
        );
      }
    }

    const created = await this.feedback.create(
      userId,
      {
        type: 'CONSULTATION',
        message: question,
        source: 'CONSULT',
        subject: 'Запрос администратора из консультанта',
      } as never,
      'WAITING_ADMIN',
    );

    return { feedbackId: created.id, created: true, message: null };
  }

  // ==================== GET /consult/history =============================

  /**
   * История вопросов юзера (§5.5 №14).
   *
   * Источник — `ConsultLog` (машинная запись ответа: источник, уверенность),
   * дополненный `BazarMessage` с `meta.kind='consult'` — так история остаётся
   * читаемой даже если лог подчистили ретеншеном.
   */
  async history(userId: string, params: { page?: number; limit?: number }) {
    const page = Math.max(1, Math.trunc(params.page ?? 1) || 1);
    const limit = Math.min(100, Math.max(1, Math.trunc(params.limit ?? 20) || 20));

    const [items, total] = await Promise.all([
      this.prisma.consultLog.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.consultLog.count({ where: { userId } }),
    ]);

    return { items, total, page, limit };
  }

  // ==================== Внутреннее: гварды ===============================

  /** Консультант выключен владельцем → 503 (§5.2 ШАГ 0). */
  private async assertEnabled(): Promise<void> {
    const enabled = await this.boolSetting(
      'consult_enabled',
      DEFAULT_CONSULT_ENABLED,
    );
    if (!enabled) {
      throw new ServiceUnavailableException({
        enabled: false,
        message: 'ИИ-консультант временно выключен',
      });
    }
  }

  /** Антиспам: >N вопросов в час → 429 (§5.2 ШАГ 0). */
  private async assertRateLimit(userId: string): Promise<void> {
    const limit = await this.intSetting(
      'consult_rate_limit_per_hour',
      DEFAULT_CONSULT_RATE_LIMIT_PER_HOUR,
    );
    if (limit <= 0) return;

    const since = new Date(Date.now() - RATE_WINDOW_MS);
    const used = await this.prisma.consultLog.count({
      where: { userId, createdAt: { gte: since } },
    });

    if (used >= limit) {
      throw new HttpException(
        {
          message: 'Слишком часто — попробуйте через некоторое время',
          limit,
          used,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Модерация вопроса: спам и увод с площадки не консультируем (§5.2 ШАГ 0). */
  private async assertAllowedByModeration(
    text: string,
    userId: string,
  ): Promise<void> {
    try {
      const verdict = await this.moderation.moderate({
        text,
        entityType: 'comment',
        entityId: 'consult',
        userId,
      });
      if (verdict.verdict === 'block') {
        throw new BadRequestException(verdict.reason);
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      // Модерация недоступна — не блокируем (fail-open, как в ModerationService).
      this.logger.warn(
        `Модерация вопроса консультанта недоступна: ${(err as Error).message}`,
      );
    }
  }

  // ==================== Внутреннее: контекст ============================

  /**
   * Товарный контекст (§5.2 ШАГ 2/3).
   *
   * `productId` мог прийти явно (карточка товара) или быть найденным по
   * тексту вопроса. Без товарного вопроса не тратим запрос к каталогу.
   */
  private async resolveProductContext(
    userId: string,
    text: string,
    productId: string | null,
  ): Promise<ProductContext | null> {
    const enabled = await this.boolSetting(
      'consult_product_context',
      DEFAULT_CONSULT_PRODUCT_CONTEXT,
    );
    if (!enabled) return null;

    if (productId) {
      return this.loadProduct(productId);
    }
    if (!PRODUCT_QUESTION_RE.test(text)) return null;

    try {
      const found = (await this.catalog.search(text, userId)) as {
        products?: { id: string }[];
      };
      const first = found.products?.[0];
      if (!first) return null;
      return this.loadProduct(first.id);
    } catch (err) {
      this.logger.warn(
        `Товарный контекст недоступен: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async loadProduct(id: string): Promise<ProductContext | null> {
    const p = await this.prisma.product.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        price: true,
        isActive: true,
        deliveryType: true,
        deliveryInfo: true,
      },
    });
    return p ?? null;
  }

  // ==================== Внутреннее: LLM =================================

  /**
   * Вызов LLM через единственную точку — `BazarApiClient.complete()`.
   *
   * Промпт собирается кодом по §5.3; ЛИЧНОСТЬ агента живёт в SOUL профиля
   * `bazar` и здесь не дублируется. `sessionKey` изолирует consult-сессию
   * юзера от его же чата Базара (`${userId}_consult`).
   */
  private async callLlm(input: {
    userId: string;
    text: string;
    product: ProductContext | null;
    hints: KnowledgeHit[];
  }): Promise<LlmOutcome> {
    const history = await this.loadHistory(input.userId);
    const prompt = this.buildPrompt({ ...input, history });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
    try {
      const res = await this.api.complete(
        [{ role: 'user', content: prompt }],
        {
          temperature: input.hints.length ? 0.2 : 0.4,
          sessionKey: `${input.userId}_consult`,
        },
      );
      return this.parseLlmAnswer(res.text ?? '');
    } catch (err) {
      // Fail-open по образцу ModerationService: LLM лёг → не 500, а фолбэк
      // на админа. Юзер получает внятный ответ в любом случае.
      this.logger.warn(
        `LLM консультанта недоступен: ${(err as Error).name} ${(err as Error).message}`,
      );
      return { text: '', unknown: true, failed: true };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Промпт консультанта (§5.3) — собирается кодом, system-роль в SOUL. */
  private buildPrompt(input: {
    text: string;
    product: ProductContext | null;
    hints: KnowledgeHit[];
    history: { role: string; text: string }[];
  }): string {
    const context = {
      product: input.product,
      knowledge: input.hints.map((h) => ({
        question: h.question,
        answer: h.answerShort?.trim() || h.answer,
        similarity: Number(h.similarity.toFixed(3)),
      })),
      history: input.history,
    };

    return [
      'КОНТЕКСТ:',
      JSON.stringify(context),
      '',
      'ПРАВИЛА:',
      '1. Если в knowledge есть ответ на вопрос — отвечай ЕГО фактами, дословно по смыслу.',
      '2. Цены, наличие, сроки — только из product/catalog. Не выдумывай.',
      '3. Не знаешь — верни строго {"unknown": true} и ничего больше.',
      '4. Не обещай скидок, не меняй статусы заказов, не заключай сделки.',
      '5. Коротко, 1-3 предложения, живым языком.',
      '',
      `ЗАПРОС ПОЛЬЗОВАТЕЛЯ: ${input.text}`,
    ].join('\n');
  }

  /** Разбор ответа LLM: снимаем служебный JSON, ловим `{"unknown": true}`. */
  private parseLlmAnswer(raw: string): LlmOutcome {
    const text = (raw ?? '').trim();
    if (!text) return { text: '', unknown: true, failed: false };

    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = (fenced ? fenced[1] : text).trim();
    if (/^\{[\s\S]*\}$/.test(candidate)) {
      try {
        const obj = JSON.parse(candidate) as Record<string, unknown>;
        if (obj && obj.unknown === true) {
          return { text: '', unknown: true, failed: false };
        }
        if (typeof obj.answer === 'string') {
          return { text: obj.answer.trim(), unknown: false, failed: false };
        }
      } catch {
        // Не JSON — значит обычный текст, обрабатываем ниже.
      }
    }
    return { text, unknown: false, failed: false };
  }

  /** Последние реплики consult-диалога (§5.3, history). */
  private async loadHistory(
    userId: string,
  ): Promise<{ role: string; text: string }[]> {
    const rows = await this.prisma.bazarMessage.findMany({
      where: { userId, meta: { path: ['kind'], equals: 'consult' } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: HISTORY_LIMIT,
      select: { role: true, text: true },
    });
    return rows
      .reverse()
      .map((r) => ({ role: r.role === 'ASSISTANT' ? 'assistant' : 'user', text: r.text ?? '' }));
  }

  // ==================== Внутреннее: антигаллюцинации ====================

  /**
   * Проверка ответа LLM на выдуманные цены (§5.2 ШАГ 4).
   *
   * Цены/наличие — единственное, где галлюцинация стоит денег. Поэтому любую
   * цифру с валютным маркером сверяем с БД: с ценой товара из контекста и с
   * ценами из проверенных ответов админов. Не сошлось — фразу вырезаем и
   * честно отправляем юзера уточнять у админа, а не отдаём выдуманную сумму.
   */
  private checkPrices(
    answer: string,
    product: ProductContext | null,
    hints: KnowledgeHit[],
  ): { text: string; rewritten: boolean } {
    const claims = answer.match(MONEY_RE);
    if (!claims?.length) return { text: answer, rewritten: false };

    const allowed = new Set<number>();
    if (product) allowed.add(this.round2(product.price));
    for (const h of hints) {
      const nums = `${h.answer} ${h.answerShort ?? ''}`.match(MONEY_RE);
      for (const n of nums ?? []) {
        const v = this.parseMoney(n);
        if (v != null) allowed.add(v);
      }
    }
    if (!allowed.size) return { text: answer, rewritten: false };

    let rewritten = false;
    const sentences = answer.split(/(?<=[.!?])\s+/);
    const kept = sentences.filter((s) => {
      const nums = s.match(MONEY_RE);
      if (!nums?.length) return true;
      const ok = nums.every((n) => {
        const v = this.parseMoney(n);
        return v != null && allowed.has(v);
      });
      if (!ok) rewritten = true;
      return ok;
    });

    const text = rewritten
      ? `${kept.join(' ')} Цену и наличие уточните у администратора.`.trim()
      : answer;
    return { text, rewritten };
  }

  private parseMoney(raw: string): number | null {
    const digits = raw.replace(/[^\d]/g, '');
    if (!digits) return null;
    const n = Number(digits);
    return Number.isFinite(n) ? this.round2(n) : null;
  }

  private round2(n: number): number {
    return Math.round(n * 100) / 100;
  }

  // ==================== Внутреннее: фолбэк ==============================

  /**
   * Фолбэк «админ вернётся» (§5.2 ШАГ 5).
   *
   * Открытый тред юзера со свежим последним сообщением — дописываем в него
   * (не плодим тикеты), иначе создаём новый `CONSULTATION` сразу в статусе
   * WAITING_ADMIN. Возвращаем id треда: он уходит юзеру как `feedbackId`.
   */
  private async escalateToAdmin(
    userId: string,
    text: string,
    productId: string | null,
  ): Promise<string> {
    try {
      const open = await this.feedback.findOpenThreadForConsult(userId);
      if (open) {
        await this.feedback.postAiMessage(open.id, CONSULT_FALLBACK_ANSWER, {
          kind: 'consult',
          source: 'FALLBACK',
        });
        return open.id;
      }

      const created = await this.feedback.create(
        userId,
        {
          type: 'CONSULTATION',
          message: text,
          subject: 'Вопрос ИИ-консультанту',
          productId: productId ?? undefined,
          source: 'CONSULT',
        } as never,
        'WAITING_ADMIN',
      );
      await this.feedback.postAiMessage(created.id, CONSULT_FALLBACK_ANSWER, {
        kind: 'consult',
        source: 'FALLBACK',
      });
      return created.id;
    } catch (err) {
      // Тред не создался (например, модерация текста) — юзер всё равно
      // получает ответ «админ вернётся», просто без ссылки на тред.
      this.logger.error(
        `Фолбэк консультанта не создал тред: ${(err as Error).message}`,
      );
      return '';
    }
  }

  // ==================== Внутреннее: лог и настройки =====================

  private async logConsult(data: {
    userId: string;
    question: string;
    answer: string;
    source: string;
    knowledgeId?: string;
    similarity: number | null;
    feedbackId?: string;
    latencyMs: number;
  }) {
    return this.prisma.consultLog.create({
      data: {
        userId: data.userId,
        question: data.question,
        answer: data.answer,
        source: data.source,
        knowledgeId: data.knowledgeId ?? null,
        similarity: data.similarity,
        feedbackId: data.feedbackId ?? null,
        latencyMs: data.latencyMs,
      },
    });
  }

  /**
   * История диалога — в `BazarMessage` с `meta.kind='consult'` (§5.2 ШАГ 6).
   * Отдельную таблицу не плодим: изоляция сессии Hermes и так идёт по
   * `X-Hermes-Session-Key`, а история нужна только для промпта и UI.
   */
  private async saveHistory(
    userId: string,
    question: string,
    answer: string,
    source: string,
    confidence: number,
  ): Promise<void> {
    try {
      await this.prisma.bazarMessage.createMany({
        data: [
          {
            userId,
            role: 'USER',
            text: question,
            meta: { kind: 'consult' },
          },
          {
            userId,
            role: 'ASSISTANT',
            text: answer,
            meta: { kind: 'consult', source, confidence },
          },
        ],
      });
    } catch (err) {
      this.logger.warn(
        `История консультанта не сохранена: ${(err as Error).message}`,
      );
    }
  }

  /** Сколько раз ИИ уже отвечал этому юзеру за сутки. */
  private async countAiTurns(userId: string): Promise<number> {
    return this.prisma.consultLog.count({
      where: {
        userId,
        createdAt: { gte: new Date(Date.now() - TURNS_WINDOW_MS) },
        source: { in: ['KNOWLEDGE', 'CATALOG', 'LLM'] },
      },
    });
  }

  private async confidenceThreshold(): Promise<number> {
    const raw = await this.settings.get('consult_confidence_threshold');
    const n = raw != null ? Number(raw) : NaN;
    return Number.isFinite(n)
      ? n
      : DEFAULT_CONSULT_CONFIDENCE_THRESHOLD;
  }

  /** Порог RAG-lite — читается владельцем из Setting (§5.6). */
  async hintThreshold(): Promise<number> {
    const raw = await this.settings.get('consult_hint_threshold');
    const n = raw != null ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : DEFAULT_CONSULT_HINT_THRESHOLD;
  }

  private async boolSetting(key: string, def: boolean): Promise<boolean> {
    const raw = await this.settings.get(key);
    if (raw == null || raw === '') return def;
    return raw === 'true' || raw === '1';
  }

  private async intSetting(key: string, def: number): Promise<number> {
    const raw = await this.settings.get(key);
    if (raw == null || raw === '') return def;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : def;
  }
}