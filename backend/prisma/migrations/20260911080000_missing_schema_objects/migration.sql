-- Migration: missing_schema_objects
-- ЗАПЛАТКА САМОДОСТАТОЧНОСТИ МИГРАЦИЙ (аудит M1, 2026-09-12).
--
-- ПРОБЛЕМА: исторически схема велась через `prisma db push`, миграции писались
-- «поверх» уже существующей БД и потому НЕ создают:
--   * 7 enum-типов (TransactionStatus, ProductType, BazarRole, DealStatus,
--     DealSource, PaymentProvider, PayoutStatus)
--   * 8 таблиц (Deal, BazarMessage, ChatMessage, AuditLog, AutopilotRun,
--     CounterOffer, ViewEvent, ProactiveEvent)
--   * колонки Product.*, Transaction.*, User.*, WithdrawalRequest.*
-- Из-за этого `prisma migrate deploy` на ЧИСТОЙ БД падает на money_contour
-- (`type "TransactionStatus" does not exist`, SQLSTATE 42704).
--
-- ПОЧЕМУ ЭТА МИГРАЦИЯ ИДЁТ ПЕРЕД money_contour, А НЕ ЯВЛЯЕТСЯ ЕГО ПРАВКОЙ:
-- money_contour в боевой БД записан как УСПЕШНО применённый (_prisma_migrations,
-- finished_at=2026-09-11 09:01:14). Правка применённой миграции ломает checksum
-- и Prisma отказывается работать («migration was modified after it was applied»).
-- Prisma применяет миграции в лексикографическом порядке имён каталогов,
-- поэтому новая миграция со timestamp 20260911080000 встаёт МЕЖДУ
-- 20260520002809_add_avatar и 20260911090000_money_contour без переименований.
--
-- ИДЕМПОТЕНТНОСТЬ: каждое утверждение защищено IF NOT EXISTS / DO-блоком.
-- На боевой БД (где всё это уже есть) миграция — полный no-op:
-- ни один объект не создаётся и не изменяется (доказано в отчёте §3).

-- ============================================================
-- 1. Отсутствующие enum-типы
--    (EscrowStatus / PriceSource / LedgerAccount НЕ трогаем —
--     их создаёт money_contour, идущий следующим)
-- ============================================================

DO $$ BEGIN
  CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'SWEPT', 'FAILED', 'UNDERPAID', 'OVERPAID', 'REFUNDED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ProductType" AS ENUM ('PHYSICAL', 'DIGITAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "BazarRole" AS ENUM ('USER', 'ASSISTANT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "DealStatus" AS ENUM ('NEW', 'CONTACTED', 'NEGOTIATING', 'ACCEPTED', 'CLOSED', 'LOST');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "DealSource" AS ENUM ('BAZAR_CHAT', 'FEED', 'DIRECT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PaymentProvider" AS ENUM ('NOWPAYMENTS', 'PAYMOD');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'SUBMITTED', 'CONFIRMED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 2. Недостающие колонки существующих таблиц
--    (колонки, которые добавляет money_contour, здесь НЕ дублируются)
-- ============================================================

-- Product: type/isAd/videoUrl/deliveryType/deliveryInfo/tags
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "type" "ProductType" NOT NULL DEFAULT 'PHYSICAL';
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "isAd" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "videoUrl" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "deliveryType" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "deliveryInfo" JSONB;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- User: профиль/доверие/базар (availableBalance добавляет money_contour)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "chatPublicKey" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "walletAddress" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "trustScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "trustScoreAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bazarWelcomed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bazarSessionKey" TEXT;

-- Transaction: платёжный контур (status-конвертацию и confirmations/expectedAmountRaw/
-- receivedAmountRaw/mismatchReason/confirmedAt/tokenDecimals делает money_contour)
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "provider" "PaymentProvider" NOT NULL DEFAULT 'NOWPAYMENTS';
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "clientRef" TEXT;
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "depositAddress" TEXT;
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "chain" TEXT;
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "token" TEXT;
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "txHash" TEXT;
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "amountRaw" TEXT;

-- WithdrawalRequest: выводы (ledgerEntryId/payoutAttempts добавляет money_contour)
ALTER TABLE "WithdrawalRequest" ADD COLUMN IF NOT EXISTS "toAddress" TEXT;
ALTER TABLE "WithdrawalRequest" ADD COLUMN IF NOT EXISTS "provider" "PaymentProvider" DEFAULT 'PAYMOD';
ALTER TABLE "WithdrawalRequest" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
ALTER TABLE "WithdrawalRequest" ADD COLUMN IF NOT EXISTS "payoutTxHash" TEXT;
ALTER TABLE "WithdrawalRequest" ADD COLUMN IF NOT EXISTS "payoutStatus" "PayoutStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "WithdrawalRequest" ADD COLUMN IF NOT EXISTS "payoutError" TEXT;

-- ============================================================
-- 3. Отсутствующие таблицы
--    (LedgerEntry создаёт money_contour; SellerRequest — следующая миграция)
-- ============================================================

CREATE TABLE IF NOT EXISTS "Deal" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "productId" TEXT,
    "source" "DealSource" NOT NULL DEFAULT 'BAZAR_CHAT',
    "status" "DealStatus" NOT NULL DEFAULT 'NEW',
    "orderId" TEXT,
    "lastMsgAt" TIMESTAMP(3),
    "msgCount" INTEGER NOT NULL DEFAULT 0,
    "sellerLastSeenAt" TIMESTAMP(3),
    "buyerLastSeenAt" TIMESTAMP(3),
    "dispute" TEXT,
    "originMsgId" TEXT,
    "cashPrice" DOUBLE PRECISION,
    "disputeVerdict" TEXT,
    "disputeResolvedAt" TIMESTAMP(3),
    "disputeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BazarMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "BazarRole" NOT NULL DEFAULT 'USER',
    "text" TEXT,
    "refs" JSONB,
    "meta" JSONB,
    "dealId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BazarMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ChatMessage" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "text" TEXT,
    "ciphertext" TEXT,
    "fileUrl" TEXT,
    "fileName" TEXT,
    "fileType" TEXT,
    "fileSize" INTEGER,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AutopilotRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'AUTOPILOT',
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "goal" TEXT NOT NULL,
    "budget" DOUBLE PRECISION,
    "maxSteps" INTEGER NOT NULL DEFAULT 5,
    "step" INTEGER NOT NULL DEFAULT 0,
    "lastStepAt" TIMESTAMP(3),
    "error" TEXT,
    "context" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AutopilotRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CounterOffer" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "byUserId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CounterOffer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ViewEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ViewEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProactiveEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProactiveEvent_pkey" PRIMARY KEY ("id")
);

-- ============================================================
-- 4. Индексы
-- ============================================================

CREATE INDEX IF NOT EXISTS "Deal_buyerId_sellerId_idx" ON "Deal"("buyerId", "sellerId");
CREATE INDEX IF NOT EXISTS "Deal_sellerId_status_idx" ON "Deal"("sellerId", "status");
CREATE INDEX IF NOT EXISTS "Deal_orderId_idx" ON "Deal"("orderId");
CREATE INDEX IF NOT EXISTS "BazarMessage_userId_createdAt_idx" ON "BazarMessage"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "BazarMessage_dealId_createdAt_idx" ON "BazarMessage"("dealId", "createdAt");
CREATE INDEX IF NOT EXISTS "AutopilotRun_userId_kind_status_idx" ON "AutopilotRun"("userId", "kind", "status");
CREATE INDEX IF NOT EXISTS "CounterOffer_dealId_status_idx" ON "CounterOffer"("dealId", "status");
CREATE INDEX IF NOT EXISTS "ViewEvent_productId_userId_idx" ON "ViewEvent"("productId", "userId");
CREATE INDEX IF NOT EXISTS "ViewEvent_userId_createdAt_idx" ON "ViewEvent"("userId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "ProactiveEvent_userId_kind_refId_key" ON "ProactiveEvent"("userId", "kind", "refId");
CREATE UNIQUE INDEX IF NOT EXISTS "Transaction_clientRef_key" ON "Transaction"("clientRef");
CREATE UNIQUE INDEX IF NOT EXISTS "Transaction_txHash_key" ON "Transaction"("txHash");
CREATE UNIQUE INDEX IF NOT EXISTS "WithdrawalRequest_idempotencyKey_key" ON "WithdrawalRequest"("idempotencyKey");

-- ============================================================
-- 5. Внешние ключи (идемпотентно через pg_constraint)
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Deal_buyerId_fkey') THEN
    ALTER TABLE "Deal" ADD CONSTRAINT "Deal_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Deal_sellerId_fkey') THEN
    ALTER TABLE "Deal" ADD CONSTRAINT "Deal_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Deal_productId_fkey') THEN
    ALTER TABLE "Deal" ADD CONSTRAINT "Deal_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Deal_orderId_fkey') THEN
    ALTER TABLE "Deal" ADD CONSTRAINT "Deal_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BazarMessage_userId_fkey') THEN
    ALTER TABLE "BazarMessage" ADD CONSTRAINT "BazarMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BazarMessage_dealId_fkey') THEN
    ALTER TABLE "BazarMessage" ADD CONSTRAINT "BazarMessage_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatMessage_senderId_fkey') THEN
    ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatMessage_receiverId_fkey') THEN
    ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AuditLog_userId_fkey') THEN
    ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CounterOffer_dealId_fkey') THEN
    ALTER TABLE "CounterOffer" ADD CONSTRAINT "CounterOffer_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;