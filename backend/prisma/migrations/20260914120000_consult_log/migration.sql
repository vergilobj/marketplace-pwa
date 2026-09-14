-- ЭТАП 2 ТЗ «ИИ-консультант» (§5.2 ШАГ 6, §5.5 №14, §5.6).
--
-- Что делает:
--   1) создаёт ConsultLog — телеметрию ответов ИИ-консультанта;
--   2) заводит настройки консультанта в Setting (key/value).
--
-- Чего НЕ делает (осознанно, Этап 3):
--   - не создаёт KnowledgeEntry / KnowledgeCandidate (база знаний — Этап 3);
--   - не включает pg_trgm (нужен только для поиска по базе знаний).
--
-- Типы: User.id — TEXT (НЕ uuid), но FK на User здесь НЕТ намеренно:
-- userId — просто значение (как в ConsultLog из SPEC §4.1). Это позволяет
-- не трогать модель User (её правят параллельные задачи).
--
-- Идемпотентность: IF NOT EXISTS / ON CONFLICT — файл можно накатить повторно
-- (боевая БД частично ведётся через `db push`).

CREATE TABLE IF NOT EXISTS "ConsultLog" (
  "id"          TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "question"    TEXT NOT NULL,
  "answer"      TEXT NOT NULL,
  "source"      TEXT NOT NULL,
  "knowledgeId" TEXT,
  "similarity"  DOUBLE PRECISION,
  "helpful"     BOOLEAN,
  "feedbackId"  TEXT,
  "latencyMs"   INTEGER,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConsultLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ConsultLog_userId_createdAt_idx"
  ON "ConsultLog"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "ConsultLog_source_createdAt_idx"
  ON "ConsultLog"("source", "createdAt");

-- Настройки ИИ-консультанта (§5.6). Читаются через SettingsService, НЕ из .env,
-- чтобы владелец мог менять их без деплоя. Значения совпадают с дефолтами в
-- ConsultService — прод и тесты ведут себя одинаково.
INSERT INTO "Setting" (key, value) VALUES
  ('consult_enabled', 'true'),
  ('consult_confidence_threshold', '0.45'),
  ('consult_hint_threshold', '0.25'),
  ('consult_max_ai_turns', '5'),
  ('consult_rate_limit_per_hour', '20'),
  ('consult_product_context', 'true')
ON CONFLICT (key) DO NOTHING;