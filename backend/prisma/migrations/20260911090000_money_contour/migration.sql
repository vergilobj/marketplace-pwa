-- Migration: money_contour
-- Этап 1 ТЗ «денежный контур Базар» (§1.2, §1.3).
-- Аддитивная миграция: существующие данные не разрушаем, backfill в конце.

-- ============ 1. Новые enum ============

-- CreateEnum
CREATE TYPE "EscrowStatus" AS ENUM ('NONE', 'HELD', 'RELEASED', 'REFUNDED', 'SPLIT');

-- CreateEnum
CREATE TYPE "PriceSource" AS ENUM ('PRODUCT', 'DEAL');

-- CreateEnum
CREATE TYPE "LedgerAccount" AS ENUM ('ESCROW', 'AVAILABLE', 'REFERRAL', 'PLATFORM');

-- AlterEnum: новые терминальные/спорные статусы заказа
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'DISPUTED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'REFUNDED';

-- AlterEnum: статусы сверки депозита
ALTER TYPE "TransactionStatus" ADD VALUE IF NOT EXISTS 'UNDERPAID';
ALTER TYPE "TransactionStatus" ADD VALUE IF NOT EXISTS 'OVERPAID';
ALTER TYPE "TransactionStatus" ADD VALUE IF NOT EXISTS 'REFUNDED';

-- ============ 2. User ============

ALTER TABLE "User" ADD COLUMN "availableBalance" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- ============ 3. Order ============

-- updatedAt NOT NULL на непустой таблице: добавляем с DEFAULT, бэкфиллим, снимаем DEFAULT.
ALTER TABLE "Order"
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "autoCompleteAt" TIMESTAMP(3),
  ADD COLUMN "cancelReason" TEXT,
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "completedAt" TIMESTAMP(3),
  ADD COLUMN "dealId" TEXT,
  ADD COLUMN "escrowAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "escrowClosedAt" TIMESTAMP(3),
  ADD COLUMN "escrowHeldAt" TIMESTAMP(3),
  ADD COLUMN "escrowStatus" "EscrowStatus" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "priceSource" "PriceSource" NOT NULL DEFAULT 'PRODUCT',
  ADD COLUMN "shippedAt" TIMESTAMP(3);

-- Backfill (§1.3.2): updatedAt = createdAt для легаси-строк.
UPDATE "Order" SET "updatedAt" = "createdAt" WHERE "updatedAt" > "createdAt";

ALTER TABLE "Order" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- Легаси-заказы: эскроу по ним не создавался, cron их не должен трогать.
UPDATE "Order"
SET "escrowStatus" = 'NONE', "escrowAmount" = 0, "autoCompleteAt" = NULL
WHERE "autoCompleteAt" IS NULL;

-- ============ 4. Transaction: status String -> enum ============

ALTER TABLE "Transaction"
  ADD COLUMN "confirmations" INTEGER,
  ADD COLUMN "confirmedAt" TIMESTAMP(3),
  ADD COLUMN "expectedAmountRaw" TEXT,
  ADD COLUMN "mismatchReason" TEXT,
  ADD COLUMN "receivedAmountRaw" TEXT,
  ADD COLUMN "tokenDecimals" INTEGER NOT NULL DEFAULT 18;

-- Конвертация колонки без потери данных: нормализуем легаси-значения через UPPER()
-- ('pending'/'success' из nowpayments-ветки) и кастуем только валидные.
ALTER TABLE "Transaction" ADD COLUMN "status_new" "TransactionStatus" NOT NULL DEFAULT 'PENDING';

UPDATE "Transaction"
SET "status_new" = CASE
  WHEN UPPER(COALESCE("status", 'PENDING')) IN ('PENDING', 'CONFIRMED', 'SWEPT', 'FAILED', 'UNDERPAID', 'OVERPAID', 'REFUNDED')
    THEN UPPER("status")::"TransactionStatus"
  ELSE 'PENDING'
END;

ALTER TABLE "Transaction" DROP COLUMN "status";
ALTER TABLE "Transaction" RENAME COLUMN "status_new" TO "status";

-- Backfill (§1.3.2): ожидаемая сумма по умолчанию = выставленный amountRaw.
UPDATE "Transaction" SET "expectedAmountRaw" = "amountRaw" WHERE "expectedAmountRaw" IS NULL;

-- ============ 5. WithdrawalRequest ============

ALTER TABLE "WithdrawalRequest"
  ADD COLUMN "ledgerEntryId" TEXT,
  ADD COLUMN "payoutAttempts" INTEGER NOT NULL DEFAULT 0;

-- ============ 6. LedgerEntry ============

CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "account" "LedgerAccount" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USDT',
    "type" TEXT NOT NULL,
    "orderId" TEXT,
    "dealId" TEXT,
    "refKey" TEXT NOT NULL,
    "balanceAfter" DOUBLE PRECISION,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LedgerEntry_refKey_key" ON "LedgerEntry"("refKey");
CREATE INDEX "LedgerEntry_userId_account_createdAt_idx" ON "LedgerEntry"("userId", "account", "createdAt");
CREATE INDEX "LedgerEntry_orderId_idx" ON "LedgerEntry"("orderId");
CREATE INDEX "LedgerEntry_account_createdAt_idx" ON "LedgerEntry"("account", "createdAt");

ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============ 7. Индексы Order ============

CREATE UNIQUE INDEX "Order_dealId_key" ON "Order"("dealId");
CREATE INDEX "Order_status_autoCompleteAt_idx" ON "Order"("status", "autoCompleteAt");
CREATE INDEX "Order_sellerId_escrowStatus_idx" ON "Order"("sellerId", "escrowStatus");

-- ============ 8. Настройки денежного контура (§8.3) ============

INSERT INTO "Setting" ("key", "value") VALUES
  ('escrow_ship_deadline_days', '5'),
  ('escrow_autocomplete_days', '7'),
  ('deposit_tolerance_percent', '1'),
  ('withdrawal_min_amount', '10'),
  ('order_payment_ttl_minutes', '15')
ON CONFLICT ("key") DO NOTHING;