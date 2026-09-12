import { Injectable, Logger } from '@nestjs/common';
import { LedgerAccount, Prisma, TransactionStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LedgerService } from './ledger.service';
import { PaymentsService } from './payments.service';
import { fromRaw } from './money.util';
import { readCartPayload } from './cart.util';

/**
 * Обработчик события deposit от paymod sidecar (§6 ТЗ, этап 5).
 *
 * Что изменилось относительно старой версии:
 *   - сверяется АДРЕС получателя (не только chain/token);
 *   - сумма считается через BigInt и tokenDecimals, а не хардкод 1e18;
 *   - ветки CONFIRMED / OVERPAID / UNDERPAID с записью в Transaction;
 *   - переплата зачисляется покупателю на внутренний баланс (§6.2);
 *   - депозит по терминальному заказу (CANCELLED/REFUNDED) не теряется —
 *     зачисляется покупателю как сиротский (§5.4) + алерт.
 *
 * Идемпотентность: по уникальному tx_hash. Повторный webhook — no-op.
 */
@Injectable()
export class PaymodWebhookHandler {
  private readonly logger = new Logger(PaymodWebhookHandler.name);

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private ledger: LedgerService,
    private notifications: NotificationsService,
    private paymentsService: PaymentsService,
  ) {}

  /**
   * Явное приведение скаляра из нетипизированного payload (webhook) к строке.
   * `String(unknown)` на объекте даёт '[object Object]' — правило
   * no-base-to-string справедливо ловит это. Здесь мы осознанно допускаем
   * только скалярные типы, всё остальное (объект/массив/null) → ''.
   */
  private toScalarString(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'bigint') {
      return String(value);
    }
    if (typeof value === 'boolean') return String(value);
    return '';
  }

  async handleDeposit(body: Record<string, unknown>): Promise<void> {
    const clientRef = (body.client_ref as string) || '';
    const txHash = (body.tx_hash as string) || '';
    const amountRaw = this.toScalarString(body.amount_raw);
    const chain = (body.chain as string) || '';
    const token = (body.token as string) || '';
    const to = (body.to as string) || '';

    if (!clientRef || !txHash) {
      this.logger.warn('deposit event missing client_ref or tx_hash, ignored');
      return;
    }

    // Идемпотентность по txHash. Проверяем и колонку Transaction.txHash
    // (последний обработанный хэш), и append-only список в payload.deposit.hashes
    // (D2). Без списка replay первого UNDERPAID-депозита проходит проверку:
    // его хэш был перезаписан хэшем догоняющего депозита, и повторная
    // обработка задваивает зачисленное.
    const existing = await this.prisma.transaction.findUnique({
      where: { txHash },
    });
    if (existing) {
      this.logger.log(`deposit already processed: tx=${txHash}`);
      return;
    }

    const transaction = await this.prisma.transaction.findUnique({
      where: { clientRef },
      include: { order: true },
    });
    if (!transaction) {
      this.logger.warn(`transaction not found for client_ref=${clientRef}`);
      return;
    }
    if (this.processedHashes(transaction.payload).includes(txHash)) {
      this.logger.log(
        `deposit already processed (payload hashes): tx=${txHash} client_ref=${clientRef}`,
      );
      return;
    }
    if (
      transaction.status === TransactionStatus.CONFIRMED ||
      transaction.status === TransactionStatus.SWEPT ||
      transaction.status === TransactionStatus.OVERPAID
    ) {
      this.logger.log(`transaction ${transaction.id} already confirmed, skip`);
      return;
    }

    // §6.1(1): адрес получателя — депозит должен прийти на наш depositAddress.
    if (
      transaction.depositAddress &&
      to &&
      to.toLowerCase() !== transaction.depositAddress.toLowerCase()
    ) {
      await this.reject(transaction.id, 'address_mismatch', { to });
      return;
    }

    // §6.1(2): chain / token — помечаем mismatchReason, не молча выходим.
    if (transaction.chain && chain && transaction.chain !== chain) {
      await this.reject(transaction.id, 'chain_mismatch', { chain });
      return;
    }
    if (transaction.token && token && transaction.token !== token) {
      await this.reject(transaction.id, 'token_mismatch', { token });
      return;
    }

    // ===== §6.1(3): сверка суммы через BigInt =====
    const received = this.parseRawAmount(amountRaw);
    if (received === null) {
      // Формат неясен/пусто — НЕ подтверждаем. Оставляем PENDING, пишем причину.
      this.logger.warn(
        `unverifiable amount_raw for ${transaction.id}: ${JSON.stringify(amountRaw)} — deposit left PENDING`,
      );
      await this.prisma.transaction.update({
        where: { id: transaction.id },
        data: {
          txHash,
          amountRaw: amountRaw || transaction.amountRaw,
          mismatchReason: 'unverifiable_amount_raw',
          payload: this.mergePayload(transaction.payload, {
            hashes: this.appendHash(transaction.payload, txHash),
          }),
        },
      });
      return;
    }

    const decimals = transaction.tokenDecimals ?? 18;
    const expected = this.expectedRaw(transaction, decimals);
    const prev = this.prevReceived(transaction.payload);
    const totalReceived = prev + received;

    // A3: корзина ли это? (один депозит на N заказов). null — обычный заказ.
    // Читается ДО сверки суммы: при недоплате уведомление и алерт должны
    // показывать сумму ВСЕЙ корзины, а не якорного заказа. Чистая функция
    // (cart.util) — моки PaymentsService в юнит-тестах остаются валидными.
    const cart = readCartPayload(transaction.payload);

    const tolerancePct = await this.tolerancePercent();
    // Допуск = max(relative%, 0.01 USDT) — на дешёвых товарах 1% был бы
    // «сойдёт и половина суммы» (§6.4).
    const relRaw = (expected * BigInt(Math.round(tolerancePct * 100))) / 10000n;
    const minRaw = this.toRawBigInt(0.01, decimals);
    const tolerance = relRaw > minRaw ? relRaw : minRaw;

    // ---- НЕДОПЛАТА СВЕРХ ДОПУСКА: не подтверждаем ----
    if (totalReceived + tolerance < expected) {
      const shortfall = expected - totalReceived;
      this.logger.warn(
        `UNDERPAID deposit for ${transaction.id}: expected=${expected}, ` +
          `received=${totalReceived}, shortfall=${shortfall} — order NOT processed`,
      );
      await this.prisma.transaction.update({
        where: { id: transaction.id },
        data: {
          status: TransactionStatus.UNDERPAID,
          txHash,
          amountRaw: totalReceived.toString(),
          expectedAmountRaw: expected.toString(),
          receivedAmountRaw: totalReceived.toString(),
          mismatchReason: 'underpaid',
          payload: this.mergePayload(transaction.payload, {
            underpaid: true,
            expectedRaw: expected.toString(),
            receivedRaw: totalReceived.toString(),
            shortfallRaw: shortfall.toString(),
            lastTxHash: txHash,
            checkedAt: new Date().toISOString(),
            hashes: this.appendHash(transaction.payload, txHash),
          }),
        },
      });

      if (transaction.order) {
        await this.notifySafely(
          transaction.order.buyerId,
          'order',
          `Недоплата: пришло ${fromRaw(totalReceived, decimals)}, нужно ${
            cart ? cart.total : transaction.amount
          } USDT. Дошлите остаток.`,
          transaction.orderId,
        );
      }
      this.logger.error(
        `ALERT UNDERPAID: ${
          cart ? 'корзина' : 'заказ'
        } ${transaction.orderId}, ждали ${
          cart ? cart.total : transaction.amount
        }, пришло ${fromRaw(totalReceived, decimals)}`,
      );
      return;
    }

    // ---- ПЕРЕПЛАТА / ТОЧНАЯ ОПЛАТА ----
    const overpay = totalReceived - expected;
    const isOverpaid = overpay > 0n;

    // ===== A3: КОРЗИНА — один депозит раскладывается по N заказам =====
    //
    // Каждый заказ холдится отдельно на свой amount (инвариант
    // platformFee+referral+net===amount не трогается). Здесь только фиксируем
    // факт подтверждения Transaction — деньги уже разнесены.
    if (cart) {
      await this.paymentsService.processSuccessfulCartPayment(
        cart.orderIds,
        totalReceived,
        decimals,
      );

      await this.prisma.transaction.update({
        where: { id: transaction.id },
        data: {
          status: isOverpaid
            ? TransactionStatus.OVERPAID
            : TransactionStatus.CONFIRMED,
          txHash,
          amountRaw: totalReceived.toString(),
          expectedAmountRaw: expected.toString(),
          receivedAmountRaw: totalReceived.toString(),
          confirmations: this.readConfirmations(body),
          confirmedAt: new Date(),
          mismatchReason: null,
          payload: this.mergePayload(transaction.payload, {
            underpaid: false,
            overpaid: isOverpaid,
            expectedRaw: expected.toString(),
            receivedRaw: totalReceived.toString(),
            lastTxHash: txHash,
            checkedAt: new Date().toISOString(),
            hashes: this.appendHash(transaction.payload, txHash),
          }),
        },
      });

      this.logger.log(
        `CART deposit processed: client_ref=${clientRef} tx=${txHash} ` +
          `orders=${cart.orderIds.length}` +
          (isOverpaid ? ' (OVERPAID)' : ''),
      );
      return;
    }

    // §5.4: заказ в терминальном статусе (CANCELLED/REFUNDED) — депозит
    // пришёл после отмены. Молча терять чужие деньги нельзя.
    if (
      transaction.order &&
      (transaction.order.status === 'CANCELLED' ||
        transaction.order.status === 'REFUNDED')
    ) {
      const human = fromRaw(totalReceived, decimals);
      await this.prisma.transaction.update({
        where: { id: transaction.id },
        data: {
          status: TransactionStatus.CONFIRMED,
          txHash,
          amountRaw: totalReceived.toString(),
          receivedAmountRaw: totalReceived.toString(),
          confirmedAt: new Date(),
          mismatchReason: 'deposit_after_cancel',
          payload: this.mergePayload(transaction.payload, {
            hashes: this.appendHash(transaction.payload, txHash),
          }),
        },
      });
      await this.ledger.credit(null, {
        userId: transaction.order.buyerId,
        account: LedgerAccount.AVAILABLE,
        amount: human,
        type: 'orphan_deposit',
        refKey: `orphan_deposit:tx:${txHash}`,
        orderId: transaction.orderId,
      });
      this.logger.error(
        `ALERT orphan deposit ${human} USDT по отменённому заказу ${transaction.orderId}`,
      );
      await this.notifySafely(
        transaction.order.buyerId,
        'order',
        `Депозит ${human} USDT зачислен на баланс: заказ был отменён.`,
        transaction.orderId,
      );
      return;
    }

    // ---- Подтверждаем заказ: эскроу-холд (этап 3) ----
    //
    // NH2: Transaction.status = CONFIRMED + txHash пишутся ПОСЛЕ успешного
    // холда. Раньше апдейт стоял ВЫШЕ вызова processSuccessfulPayment —
    // при падении холда Transaction уже был CONFIRMED, и повторная доставка
    // webhook'а короткозамыкалась дедупом (:53-59 по txHash, :75-82 по
    // status===CONFIRMED). holdForOrder не вызывался НИКОГДА: Order висел
    // PENDING → cancelExpiredOrders переводил его в CANCELLED, деньги
    // покупателя оставались в блокчейне, refundEscrow требовал HELD →
    // зависали навсегда.
    //
    // Порядок теперь: сначала холд (он идемпотентен по escrowStatus=NONE и
    // refKey), и только потом фиксация CONFIRMED. Если холд упал — исключение
    // уходит наверх (webhook 5xx), Transaction остаётся в состоянии,
    // допускающем повторный проход, а processSuccessfulPayment уже откатил
    // заказ в PENDING (своя компенсация). Ретрай sidecar'а дойдёт до холда.
    await this.paymentsService.processSuccessfulPayment(transaction.orderId);

    // Только теперь фиксируем факт подтверждения депозита. Хэш добавляем в
    // append-only список, чтобы повторная доставка того же события после
    // успешного холда оставалась no-op на любом уровне дедупа.
    await this.prisma.transaction.update({
      where: { id: transaction.id },
      data: {
        status: isOverpaid
          ? TransactionStatus.OVERPAID
          : TransactionStatus.CONFIRMED,
        txHash,
        amountRaw: totalReceived.toString(),
        expectedAmountRaw: expected.toString(),
        receivedAmountRaw: totalReceived.toString(),
        confirmations: this.readConfirmations(body),
        confirmedAt: new Date(),
        mismatchReason: null,
        payload: this.mergePayload(transaction.payload, {
          underpaid: false,
          overpaid: isOverpaid,
          expectedRaw: expected.toString(),
          receivedRaw: totalReceived.toString(),
          lastTxHash: txHash,
          checkedAt: new Date().toISOString(),
          hashes: this.appendHash(transaction.payload, txHash),
        }),
      },
    });

    // §6.2: переплату зачисляем покупателю на внутренний баланс. Возврат
    // в блокчейн дорог — внутренний баланс выводится штатным флоу.
    if (isOverpaid && transaction.order) {
      const overHuman = fromRaw(overpay, decimals);
      if (overHuman > 0) {
        await this.ledger.credit(null, {
          userId: transaction.order.buyerId,
          account: LedgerAccount.AVAILABLE,
          amount: overHuman,
          type: 'deposit_overpay',
          refKey: `deposit_overpay:tx:${txHash}`,
          orderId: transaction.orderId,
        });
        await this.notifySafely(
          transaction.order.buyerId,
          'order',
          `Переплата ${overHuman} USDT зачислена на баланс.`,
          transaction.orderId,
        );
      }
    }

    this.logger.log(
      `deposit processed: client_ref=${clientRef} tx=${txHash} order=${transaction.orderId}` +
        (isOverpaid ? ' (OVERPAID)' : ''),
    );
  }

  // ─── внутреннее ────────────────────────────────────────────────────────

  /** §6.1: ожидаемая сумма в атомарных единицах (BigInt). */
  private expectedRaw(
    transaction: {
      expectedAmountRaw: string | null;
      amountRaw: string | null;
      amount: number;
    },
    decimals: number,
  ): bigint {
    const source = transaction.expectedAmountRaw ?? transaction.amountRaw;
    if (source && /^\d+$/.test(source.trim())) {
      return BigInt(source.trim());
    }
    return this.toRawBigInt(transaction.amount, decimals);
  }

  private toRawBigInt(amount: number, decimals: number): bigint {
    const micros = BigInt(Math.round(amount * 1_000_000));
    if (decimals <= 6) return micros / 10n ** BigInt(6 - decimals);
    return micros * 10n ** BigInt(decimals - 6);
  }

  private async tolerancePercent(): Promise<number> {
    const raw = await this.settings.getFloat('deposit_tolerance_percent');
    return Number.isFinite(raw) && raw > 0 ? raw : 1;
  }

  /** Помечаем транзакцию FAILED с причиной (адрес/сеть/токен). */
  private async reject(
    transactionId: string,
    reason: string,
    extra: Record<string, unknown>,
  ): Promise<void> {
    this.logger.error(`deposit rejected for ${transactionId}: ${reason}`);
    await this.prisma.transaction.update({
      where: { id: transactionId },
      data: { status: TransactionStatus.FAILED, mismatchReason: reason },
    });
    this.logger.error(
      `ALERT ${reason}: transaction ${transactionId} ${JSON.stringify(extra)}`,
    );
  }

  private readConfirmations(body: Record<string, unknown>): number | null {
    const raw = body.confirmations;
    const n =
      typeof raw === 'number' ? raw : parseInt(this.toScalarString(raw), 10);
    return Number.isFinite(n) ? n : null;
  }

  private mergePayload(
    payload: unknown,
    patch: Record<string, unknown>,
  ): Prisma.InputJsonValue {
    const obj = this.asObject(payload) ?? {};
    const deposit = this.asObject(obj.deposit) ?? {};
    return {
      ...obj,
      deposit: { ...deposit, ...patch },
    } as Prisma.InputJsonValue;
  }

  /** Строгий парс атомарной суммы: только десятичные цифры. null — формат неясен. */
  private parseRawAmount(raw: string): bigint | null {
    const trimmed = raw.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    try {
      return BigInt(trimmed);
    } catch {
      return null;
    }
  }

  /** Ранее зачисленная по этому clientRef сумма (для догоняющих депозитов). */
  private prevReceived(payload: unknown): bigint {
    const obj = this.asObject(payload);
    const deposit = obj?.deposit as Record<string, unknown> | undefined;
    const raw = deposit?.receivedRaw;
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return 0n;
    try {
      return BigInt(raw);
    } catch {
      return 0n;
    }
  }

  /**
   * D2: append-only список УЖЕ обработанных txHash в payload.deposit.hashes.
   * Одно поле txHash перезаписывалось хэшем догоняющего депозита, из-за чего
   * replay первого webhook'а проходил проверку и задваивал зачисленное.
   */
  private processedHashes(payload: unknown): string[] {
    const obj = this.asObject(payload);
    const deposit = obj?.deposit as Record<string, unknown> | undefined;
    const raw = deposit?.hashes;
    if (!Array.isArray(raw)) return [];
    return raw.filter((h): h is string => typeof h === 'string');
  }

  /** Добавить хэш в append-only список (идемпотентно, без дублей). */
  private appendHash(payload: unknown, txHash: string): string[] {
    const hashes = this.processedHashes(payload);
    return hashes.includes(txHash) ? hashes : [...hashes, txHash];
  }

  private asObject(value: unknown): Record<string, unknown> | null {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  }

  private async notifySafely(
    userId: string,
    type: string,
    message: string,
    relatedId?: string,
  ): Promise<void> {
    try {
      await this.notifications.createNotification(
        userId,
        type,
        message,
        relatedId,
      );
    } catch (err) {
      this.logger.warn(
        `notification to ${userId} failed: ${(err as Error).message}`,
      );
    }
  }
}
