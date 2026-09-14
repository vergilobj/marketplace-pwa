-- ЭТАП 3 ТЗ «База знаний + обучение на ответах админов» (§6.1–6.4).
--
-- Что делает:
--   1) включает pg_trgm (нужен для поиска похожих вопросов, §6.2);
--   2) создаёт KnowledgeEntry  — пары «вопрос → ответ» (шпаргалка админов);
--   3) создаёт KnowledgeCandidate — черновики знаний из ответов админов;
--   4) навешивает поисковые индексы (GIN trgm по questionNorm + FTS russian);
--   5) заводит недостающие настройки консультанта в Setting.
--
-- Чего НЕ делает:
--   - не трогает Feedback / FeedbackMessage / ConsultLog (Этапы 1–2);
--   - не создаёт enum-типов: статусы остаются TEXT (валидация в DTO), чтобы
--     набор состояний расширялся без миграции (§4.2, примечание);
--   - не заводит FK-relation на Product/User в schema.prisma — схему делят
--     параллельные задачи. Целостность обеспечивает сама миграция (см. ниже).
--
-- Идемпотентность: IF NOT EXISTS + DO $$ ... EXCEPTION WHEN duplicate_object.
-- Файл можно накатить повторно (часть боевой схемы ведётся через `db push`,
-- см. migrations/README.md).
--
-- ВАЖНО про db push: `prisma db push` создаёт таблицы сам, БЕЗ FK на Product
-- (их нет в schema.prisma) и без GIN-индексов. Поэтому вся «настоящая»
-- обвязка поиска живёт здесь и накатывается SQL-ом в обоих режимах.

-- ── 1. Расширение для триграммного поиска ────────────────────────────────
-- Если у роли нет прав на CREATE EXTENSION — поиск уйдёт в keyword-режим
-- (KnowledgeSearchService ловит ошибку similarity() и переключается).
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'pg_trgm недоступен — поиск по базе знаний пойдёт в keyword-режиме';
END $$;

-- ── 2. KnowledgeEntry ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "KnowledgeEntry" (
  "id"               TEXT NOT NULL,
  "question"         TEXT NOT NULL,
  "questionNorm"     TEXT NOT NULL,
  "answer"           TEXT NOT NULL,
  "answerShort"      TEXT,
  "productId"        TEXT,
  "tags"             TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "category"         TEXT,
  "source"           TEXT NOT NULL DEFAULT 'ADMIN',
  "status"           TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdById"      TEXT,
  "sourceFeedbackId" TEXT,
  "usageCount"       INTEGER NOT NULL DEFAULT 0,
  "helpfulCount"     INTEGER NOT NULL DEFAULT 0,
  "notHelpfulCount"  INTEGER NOT NULL DEFAULT 0,
  "lastUsedAt"       TIMESTAMP(3),
  "reviewDueAt"      TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnowledgeEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "KnowledgeEntry_status_lastUsedAt_idx"
  ON "KnowledgeEntry"("status", "lastUsedAt");
CREATE INDEX IF NOT EXISTS "KnowledgeEntry_status_createdAt_idx"
  ON "KnowledgeEntry"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "KnowledgeEntry_category_idx"
  ON "KnowledgeEntry"("category");
CREATE INDEX IF NOT EXISTS "KnowledgeEntry_productId_idx"
  ON "KnowledgeEntry"("productId");

-- FK на Product — снос товара не должен уносить знание (SET NULL).
DO $$
BEGIN
  ALTER TABLE "KnowledgeEntry"
    ADD CONSTRAINT "KnowledgeEntry_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_table THEN NULL; -- Product в этой БД ещё нет (тестовая база)
END $$;

-- ── 3. Поисковые индексы базы знаний (§6.2) ──────────────────────────────
-- GIN trgm — оператор `%` и similarity() по нормализованному вопросу.
DO $$
BEGIN
  CREATE INDEX IF NOT EXISTS "KnowledgeEntry_questionNorm_trgm_idx"
    ON "KnowledgeEntry" USING GIN ("questionNorm" gin_trgm_ops);
EXCEPTION WHEN undefined_object THEN
  RAISE NOTICE 'gin_trgm_ops недоступен (нет pg_trgm) — индекс не создан';
END $$;

-- FTS по 'russian' — ловит перефразировки, где trgm промахивается.
DO $$
BEGIN
  CREATE INDEX IF NOT EXISTS "KnowledgeEntry_question_fts_idx"
    ON "KnowledgeEntry" USING GIN (to_tsvector('russian', "question"));
EXCEPTION WHEN undefined_object THEN
  RAISE NOTICE 'конфигурация russian недоступна — FTS-индекс не создан';
END $$;

-- ── 4. KnowledgeCandidate ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "KnowledgeCandidate" (
  "id"               TEXT NOT NULL,
  "feedbackId"       TEXT NOT NULL,
  "messageId"        TEXT NOT NULL,
  "questionDraft"    TEXT NOT NULL,
  "answerDraft"      TEXT NOT NULL,
  "status"           TEXT NOT NULL DEFAULT 'PENDING',
  "createdById"      TEXT,
  "knowledgeEntryId" TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnowledgeCandidate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeCandidate_messageId_key" UNIQUE ("messageId")
);

CREATE INDEX IF NOT EXISTS "KnowledgeCandidate_status_createdAt_idx"
  ON "KnowledgeCandidate"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "KnowledgeCandidate_feedbackId_idx"
  ON "KnowledgeCandidate"("feedbackId");

-- ── 5. Настройки (§6.4, §5.6) ────────────────────────────────────────────
-- consult_* из Этапа 2 не дублируем: ON CONFLICT DO NOTHING сохранит значения,
-- которые владелец уже мог поменять через админку.
INSERT INTO "Setting" (key, value) VALUES
  ('consult_enabled', 'true'),
  ('consult_confidence_threshold', '0.45'),
  ('consult_hint_threshold', '0.25'),
  ('consult_max_ai_turns', '5'),
  ('consult_rate_limit_per_hour', '20'),
  ('consult_product_context', 'true'),
  ('knowledge_stale_days', '180'),
  ('knowledge_review_helpful_ratio', '0.3')
ON CONFLICT (key) DO NOTHING;