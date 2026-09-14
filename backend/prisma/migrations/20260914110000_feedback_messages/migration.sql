-- ЭТАП 1 ТЗ «Двусторонний диалог с админом» (§4.1, §4.2).
--
-- Feedback превращается в «голову треда»: добавляются поля темы/источника/
-- назначения/последнего сообщения/счётчиков непрочитанного, а сама история
-- переезжает в новую таблицу FeedbackMessage.
--
-- Типы: User.id — TEXT (НЕ uuid), поэтому все FK-колонки тоже TEXT.
-- Идемпотентность: IF NOT EXISTS / DO $$ ... EXCEPTION — файл можно накатить
-- повторно (боевая БД частично ведётся через `db push`).

-- 1. Feedback: новые поля
ALTER TABLE "Feedback"
  ADD COLUMN IF NOT EXISTS "subject"         TEXT,
  ADD COLUMN IF NOT EXISTS "productId"       TEXT,
  ADD COLUMN IF NOT EXISTS "source"          TEXT NOT NULL DEFAULT 'FORM',
  ADD COLUMN IF NOT EXISTS "assignedAdminId" TEXT,
  ADD COLUMN IF NOT EXISTS "lastMessageAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "lastMessageBy"   TEXT NOT NULL DEFAULT 'USER',
  ADD COLUMN IF NOT EXISTS "unreadForUser"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "unreadForAdmin"  INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "userLastReadAt"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "adminLastReadAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "closedAt"        TIMESTAMP(3);

DO $$ BEGIN
  ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_assignedAdminId_fkey"
    FOREIGN KEY ("assignedAdminId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. FeedbackMessage
CREATE TABLE IF NOT EXISTS "FeedbackMessage" (
  "id"            TEXT NOT NULL,
  "feedbackId"    TEXT NOT NULL,
  "authorId"      TEXT,
  "authorRole"    TEXT NOT NULL,
  "body"          TEXT NOT NULL,
  "kind"          TEXT NOT NULL DEFAULT 'TEXT',
  "meta"          JSONB,
  "attachmentUrl" TEXT,
  "isReadByUser"  BOOLEAN NOT NULL DEFAULT FALSE,
  "isReadByAdmin" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeedbackMessage_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "FeedbackMessage" ADD CONSTRAINT "FeedbackMessage_feedbackId_fkey"
    FOREIGN KEY ("feedbackId") REFERENCES "Feedback"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "FeedbackMessage" ADD CONSTRAINT "FeedbackMessage_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "FeedbackMessage_feedbackId_createdAt_idx"
  ON "FeedbackMessage"("feedbackId", "createdAt");

-- 3. Backfill: первое сообщение каждого старого обращения -> FeedbackMessage.
--    Прочитано обеими сторонами: это не «новое» сообщение.
INSERT INTO "FeedbackMessage"
  (id, "feedbackId", "authorId", "authorRole", body, kind,
   "isReadByUser", "isReadByAdmin", "createdAt")
SELECT gen_random_uuid()::text, f.id, f."userId", 'USER', f.message, 'TEXT',
       TRUE, TRUE, f."createdAt"
FROM "Feedback" f
WHERE NOT EXISTS (SELECT 1 FROM "FeedbackMessage" m WHERE m."feedbackId" = f.id);

-- 4. Backfill: старый adminNote -> сообщение админа (kind=NOTE, внутреннее).
INSERT INTO "FeedbackMessage"
  (id, "feedbackId", "authorId", "authorRole", body, kind,
   "isReadByUser", "isReadByAdmin", "createdAt")
SELECT gen_random_uuid()::text, f.id, f."assignedAdminId", 'ADMIN', f."adminNote", 'NOTE',
       TRUE, TRUE, f."updatedAt"
FROM "Feedback" f
WHERE f."adminNote" IS NOT NULL AND length(trim(f."adminNote")) > 0
  AND NOT EXISTS (
    SELECT 1 FROM "FeedbackMessage" m
    WHERE m."feedbackId" = f.id AND m.kind = 'NOTE'
  );

-- 5. lastMessageAt существующих тредов = время последнего сообщения
UPDATE "Feedback" f
SET "lastMessageAt" = m.max_created
FROM (
  SELECT "feedbackId", MAX("createdAt") AS max_created
  FROM "FeedbackMessage" GROUP BY "feedbackId"
) m
WHERE m."feedbackId" = f.id AND f."lastMessageAt" < m.max_created;

-- 6. Индексы Feedback
CREATE INDEX IF NOT EXISTS "Feedback_status_lastMessageAt_idx"
  ON "Feedback"("status", "lastMessageAt");
CREATE INDEX IF NOT EXISTS "Feedback_userId_lastMessageAt_idx"
  ON "Feedback"("userId", "lastMessageAt");
CREATE INDEX IF NOT EXISTS "Feedback_assignedAdminId_idx"
  ON "Feedback"("assignedAdminId");