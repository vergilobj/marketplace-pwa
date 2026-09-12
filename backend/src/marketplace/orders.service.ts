import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  EscrowStatus,
  OrderStatus,
  Prisma,
  TransactionStatus,
} from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { PaymentsService } from '../payments/payments.service';
import { EscrowService, EscrowCloseReason } from '../payments/escrow.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  computeFees,
  addDays,
  addMinutes,
  round2,
} from '../payments/money.util';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

/** Кто инициирует переход статуса заказа (§3 ТЗ). */
type Actor = 'BUYER' | 'SELLER' | 'ADMIN' | 'SYSTEM';

/**
 * NH8: решение покупателя по спору («возврат» / «оставить как есть»).
 *
 * Заказ маркетплейса создаётся без Deal, поэтому позиция покупателя не могла
 * попасть в арбитраж (там читался только чат/`Deal.disputeNote`). Пишем её в
 * `Order.cancelReason` как `USER_DECISION:{JSON}` — у заказа в DISPUTED это
 * поле свободно, новых полей в схеме не заводим. Арбитраж читает запись тем же
 * парсером `parseDisputeDecision` (VERDICT-контракт) и учитывает как позицию
 * покупателя. После вердикта cancelReason перезаписывается на `VERDICT:{...}`.
 */
export const ORDER_DECISION_MARKER = 'USER_DECISION:';

/**
 * L1-ФИКС (ДЕФЕКТ 2): верхняя граница возраста PENDING-заказа, который крон
 * отмены ещё имеет право трогать. Всё старше — это импорт/бэкап/компенсация,
 * а не «ожидание оплаты»; такие заказы разбирает reconciler
 * (`reconcileUnheldEscrow`), а не `cancelExpiredOrders`.
 */
export const CANCEL_MAX_AGE_MINUTES = 24 * 60; // 24 часа

/**
 * ФИКС 1: отчёт прогона `reconcileUnheldEscrow`.
 *
 * `held` / `reverted` заполняются только в режиме `apply=true`: в dry-run
 * заказы лишь классифицируются (`withConfirmedTx` / `withoutConfirmedTx`),
 * и ни одна строка не мутируется.
 */
export interface EscrowReconcileReport {
  /** Был ли реальный проход (true) или только отчёт (false). */
  apply: boolean;
  /** Сколько заказов `PAID/SHIPPED + escrowStatus=NONE` попало в пачку. */
  scanned: number;
  /** Случай (а): есть подтверждённый депозит → досоздан холд. */
  held: number;
  /** Случай (б): депозита нет → возвращены в PENDING. */
  reverted: number;
  /** Ошибки обработки (заказ остался как был). */
  failed: number;
  /** Классификация пачки (считается и в dry-run). */
  withConfirmedTx: number;
  withoutConfirmedTx: number;
  orderIds: { held: string[]; reverted: string[]; failed: string[] };
}

/**
 * Настройка-рубильник реального прохода reconciler'а. Ключа по умолчанию в
 * БД НЕТ — значит `get()` вернёт `null` и reconciler работает в dry-run.
 */
export const ESCROW_RECONCILE_APPLY_SETTING = 'escrow_reconcile_legacy_apply';

/** Статусы Transaction, означающие «деньги покупателя реально пришли». */
const FUNDED_TX_STATUSES: TransactionStatus[] = [
  TransactionStatus.CONFIRMED,
  TransactionStatus.OVERPAID,
  TransactionStatus.SWEPT,
];

export interface OrderDisputeDecision {
  /** `refund` — покупатель требует возврат; `keep` — отзывает спор. */
  decision: 'refund' | 'keep';
  /** Комментарий покупателя для арбитра (опционально). */
  note?: string | null;
  at: string;
}

/**
 * Матрица переходов заказа (§3 ТЗ). Полная замена старой логики
 * «любая роль в любой статус, кроме PAID».
 *
 * PENDING → PAID здесь ОТСУТСТВУЕТ намеренно: оплату подтверждает только
 * webhook (SYSTEM). Публичный API не умеет ставить PAID ни для кого, включая
 * админа — для ручного обхода есть adminForceStatus с обязательным reason.
 */
const TRANSITIONS: Record<
  OrderStatus,
  Partial<Record<OrderStatus, Actor[]>>
> = {
  PENDING: {
    CANCELLED: ['BUYER', 'SELLER', 'SYSTEM', 'ADMIN'],
  },
  PAID: {
    SHIPPED: ['SELLER'],
    DISPUTED: ['BUYER'],
    REFUNDED: ['ADMIN', 'SYSTEM'],
  },
  SHIPPED: {
    COMPLETED: ['BUYER', 'SYSTEM'],
    DISPUTED: ['BUYER'],
    REFUNDED: ['ADMIN'],
  },
  DISPUTED: {
    COMPLETED: ['SYSTEM'],
    REFUNDED: ['SYSTEM'],
  },
  COMPLETED: {},
  REFUNDED: {},
  CANCELLED: {},
};

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private paymentsService: PaymentsService,
    private escrowService: EscrowService,
    private settings: SettingsService,
    private notificationsService: NotificationsService,
  ) {}

  async create(buyerId: string, dto: CreateOrderDto) {
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      include: { seller: true },
    });
    if (!product || !product.isActive) {
      throw new BadRequestException('Товар недоступен');
    }
    // §7.2: валидации цены и продавца.
    if (!(product.price > 0)) {
      throw new BadRequestException('Некорректная цена товара');
    }
    if (!product.sellerId) {
      throw new BadRequestException('У товара нет продавца');
    }
    if (product.sellerId === buyerId) {
      throw new BadRequestException('Нельзя купить у себя');
    }

    // B8: цена ВСЕГДА серверная — product.price * quantity.
    // dto.amount (присланный клиентом) полностью игнорируется.
    const quantity = dto.quantity ?? 1;
    const amount = round2(product.price * quantity);

    const buyer = await this.prisma.user.findUnique({
      where: { id: buyerId },
      select: { invitedById: true },
    });

    // §7.4: комиссии считаются ЗДЕСЬ и снапшотятся в Order. Ставка, изменённая
    // после создания, не влияет на заказ. Инвариант: fee+referral+net===amount.
    const platformPercent =
      (await this.settings.getFloat('platform_fee_percent')) || 10;
    const referralPercent =
      (await this.settings.getFloat('referral_percent')) || 5;
    const referralUserId = buyer?.invitedById || null;
    const fees = computeFees(
      amount,
      platformPercent,
      referralPercent,
      Boolean(referralUserId),
    );

    const order = await this.prisma.order.create({
      data: {
        buyerId,
        sellerId: product.sellerId,
        productId: product.id,
        amount,
        platformFee: fees.platformFee,
        referralBonus: fees.referralBonus,
        referralUserId,
        status: 'PENDING',
      },
      include: {
        // G3: телефон контрагента не отдаём ни здесь, ни в GET /orders/:id.
        // Фронт его не читает (ApiOrder в api/types.ts не содержит buyer/seller;
        // в UI только сравнение с order.buyerId) — это была утечка PII.
        buyer: { select: { id: true, name: true } },
        seller: { select: { id: true, name: true } },
        product: true,
      },
    });

    // Создаём платёж (paymod) — заказ остаётся PENDING до подтверждения
    // депозита через webhook (processSuccessfulPayment вызывается там).
    const payment = await this.paymentsService.createPaymentForOrder(order.id);

    // Уведомления покупателю и продавцу + push
    const heading = { en: 'Новый заказ' };
    const buyerContents = { en: `Ваш заказ на сумму ${amount} USDT создан` };
    const sellerContents = { en: `Новый заказ на сумму ${amount} USDT` };

    await this.notificationsService.createNotification(
      product.sellerId,
      'order',
      sellerContents.en,
      order.id,
    );
    await this.notificationsService.createNotification(
      buyerId,
      'order',
      buyerContents.en,
      order.id,
    );

    try {
      await this.notificationsService.sendToUser(
        product.sellerId,
        heading,
        sellerContents,
        { screen: 'orders', orderId: order.id },
      );
      await this.notificationsService.sendToUser(
        buyerId,
        heading,
        buyerContents,
        { screen: 'orders', orderId: order.id },
      );
    } catch (err) {
      this.logger.warn(`Push for order ${order.id} failed: ${err.message}`);
    }

    await this.auditService.log({
      userId: buyerId,
      action: 'order_created',
      entity: 'order',
      entityId: order.id,
    });

    // Возвращаем заказ + информацию об оплате (depositAddress) для чекаута.
    const fullOrder = await this.fetchOrderOrThrow(order.id);
    return {
      ...fullOrder,
      payment,
    };
  }

  async findMyOrders(userId: string, role: string, status?: string) {
    const where: Prisma.OrderWhereInput =
      role === 'SELLER' ? { sellerId: userId } : { buyerId: userId };
    if (status) {
      where.status = status as OrderStatus;
    }
    return this.prisma.order.findMany({
      where,
      include: {
        product: { select: { title: true } },
        buyer: { select: { id: true, name: true } },
        seller: { select: { id: true, name: true } },
        referralUser: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * B13: чтение заказа только участником (buyer/seller) или ADMIN.
   * userId/role обязательны — внутренние вызовы используют fetchOrderOrThrow.
   */
  async findById(orderId: string, userId: string, role: string) {
    const order = await this.fetchOrderOrThrow(orderId);

    if (
      role !== 'ADMIN' &&
      order.buyerId !== userId &&
      order.sellerId !== userId
    ) {
      throw new ForbiddenException('Нет доступа к этому заказу');
    }

    return order;
  }

  /** Внутреннее чтение без проверки прав — только для кода, который сам авторизует. */
  private async fetchOrderOrThrow(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        product: true,
        // G3: PII контрагента не отдаём — см. комментарий в create().
        buyer: { select: { id: true, name: true } },
        seller: { select: { id: true, name: true } },
        referralUser: { select: { id: true, name: true } },
        // NH10: признак рекламного заказа для перехода в DISPUTED / admin-путей.
        post: { select: { id: true, isAd: true } },
      },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    return order;
  }

  /**
   * Смена статуса заказа по матрице переходов (§3 ТЗ).
   *
   * Побочные эффекты (релиз/возврат эскроу) выполняются ТОЛЬКО через
   * EscrowService — он же выставляет финальный статус атомарно. Поэтому для
   * COMPLETED/REFUNDED из PAYED/SHIPPED/DISPUTED мы не пишем status напрямую,
   * а зовём releaseEscrow/refundEscrow.
   */
  async updateStatus(
    orderId: string,
    userId: string,
    role: string,
    dto: UpdateOrderStatusDto,
  ) {
    const order = await this.fetchOrderOrThrow(orderId);
    const actor: Actor =
      role === 'ADMIN' ? 'ADMIN' : role === 'SELLER' ? 'SELLER' : 'BUYER';

    this.assertOwner(order, userId, actor);

    const allowed = TRANSITIONS[order.status]?.[dto.status];
    if (!allowed || !allowed.includes(actor)) {
      throw new ForbiddenException(
        `Переход ${order.status} → ${dto.status} запрещён для роли ${actor}`,
      );
    }

    // PENDING → CANCELLED: денег нет, эскроу не создан.
    if (dto.status === OrderStatus.CANCELLED) {
      const updated = await this.prisma.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.CANCELLED, cancelledAt: new Date() },
      });
      await this.audit(orderId, userId, 'order_cancelled');
      return updated;
    }

    // PAID → SHIPPED: продавец отправил. Дедлайн подтверждения = +7д.
    if (
      dto.status === OrderStatus.SHIPPED &&
      order.status === OrderStatus.PAID
    ) {
      const autocompleteDays = await this.settings.getInt(
        'escrow_autocomplete_days',
        7,
      );
      const updated = await this.prisma.order.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.SHIPPED,
          shippedAt: new Date(),
          autoCompleteAt: addDays(new Date(), autocompleteDays),
        },
      });
      await this.notificationsService.createNotification(
        order.buyerId,
        'order',
        'Продавец отправил заказ. Подтвердите получение.',
        orderId,
      );
      await this.audit(orderId, userId, 'order_shipped');
      return updated;
    }

    // PAID/SHIPPED → DISPUTED: спор останавливает таймер авто-закрытия.
    // DISPUTED в выборку autoCloseOrders не попадает (там только PAID/SHIPPED
    // + escrowStatus=HELD, а спор снимает autoCompleteAt) — D1.
    if (dto.status === OrderStatus.DISPUTED) {
      // NH10 (вариант B, defense in depth): на РЕКЛАМНОМ заказе спор
      // запрещён. Реклама — услуга, спорить не о чем: показ либо шёл, либо
      // нет, и закрывает её `settleAdSale`/`refundEscrow` (ad-aware). Спор
      // здесь — самоподача: `buyerId` рекламного заказа = сам рекламодатель,
      // поэтому `assertOwner` его пропускал и он открывал спор на СВОЁМ
      // заказе, чтобы вернуть деньги и оставить объявление висеть (NH10).
      // Основной фикс (вариант A) уже делает возврат ad-aware, это —
      // дополнительный барьер, чтобы маршрут вообще не открывался.
      if (order.post?.isAd) {
        throw new BadRequestException(
          'Рекламный заказ нельзя перевести в спор: размещение закрывается ' +
            'через закрытие заказа (возврат за неотработанные дни)',
        );
      }

      // NH8: решение покупателя, если он его передал («требую возврат» /
      // «оставляю как есть»). Хранится в cancelReason — поле у DISPUTED-заказа
      // свободно, схему не трогаем.
      const buyerNote =
        dto.decision && dto.decision !== 'keep'
          ? ORDER_DECISION_MARKER +
            JSON.stringify({
              decision: 'refund',
              note: dto.buyerNote ?? null,
              at: new Date().toISOString(),
            } satisfies OrderDisputeDecision)
          : undefined;

      const updated = await this.prisma.order.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.DISPUTED,
          autoCompleteAt: null,
          ...(buyerNote ? { cancelReason: buyerNote } : {}),
        },
      });

      // D6 (§5.3): спор, открытый через orders API, обязан дойти до арбитража.
      // Арбитраж ищет только Deal.dispute = 'OPEN' — без этой синхронизации
      // заказ висит в DISPUTED с замороженным эскроу вечно: ни таймаута,
      // ни арбитра, ни возврата.
      const deal = await this.prisma.deal.findFirst({
        where: { orderId },
        select: { id: true, dispute: true },
      });
      if (deal && deal.dispute !== 'RESOLVED') {
        await this.prisma.deal.update({
          where: { id: deal.id },
          data: {
            dispute: 'OPEN',
            disputeNote:
              deal.dispute === 'OPEN' ? undefined : 'Спор открыт покупателем',
          },
        });
      }

      await this.audit(orderId, userId, 'order_disputed');
      return updated;
    }

    // → COMPLETED: релиз эскроу продавцу (деньги двигает EscrowService).
    if (dto.status === OrderStatus.COMPLETED) {
      // Через API подтверждает покупатель; системный авто-релиз идёт через
      // autoCloseOrders → releaseEscrow('auto_timeout') напрямую.
      const result = await this.escrowService.releaseEscrow(
        orderId,
        'buyer_confirmed',
      );
      if (!result.released) {
        // Эскроу не в HELD (например, легаси-заказ без холда) — фиксируем
        // статус напрямую, чтобы заказ не завис.
        await this.prisma.order.update({
          where: { id: orderId },
          data: {
            status: OrderStatus.COMPLETED,
            completedAt: new Date(),
            autoCompleteAt: null,
          },
        });
      }
      await this.audit(orderId, userId, 'order_completed');
      return this.fetchOrderOrThrow(orderId);
    }

    // → REFUNDED: возврат эскроу покупателю (деньги двигает EscrowService).
    if (dto.status === OrderStatus.REFUNDED) {
      await this.escrowService.refundEscrow(orderId, 'admin_refund', 100);
      await this.audit(orderId, userId, 'order_refunded');
      return this.fetchOrderOrThrow(orderId);
    }

    throw new BadRequestException(`Неподдерживаемый переход в ${dto.status}`);
  }

  /**
   * POST /orders/:id/confirm — покупатель подтверждает получение (§3, §4.3).
   * Разрешено только из SHIPPED и только покупателю заказа.
   */
  async confirmReceipt(orderId: string, userId: string) {
    const order = await this.fetchOrderOrThrow(orderId);
    if (order.buyerId !== userId) {
      throw new ForbiddenException(
        'Подтвердить может только покупатель заказа',
      );
    }
    if (order.status !== OrderStatus.SHIPPED) {
      throw new BadRequestException(
        `Подтверждение возможно только из SHIPPED (сейчас ${order.status})`,
      );
    }

    const result = await this.escrowService.releaseEscrow(
      orderId,
      'buyer_confirmed',
    );
    if (!result.released) {
      // Эскроу не HELD (легаси) — закрываем заказ вручную.
      await this.prisma.order.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.COMPLETED,
          completedAt: new Date(),
          autoCompleteAt: null,
        },
      });
    }
    await this.audit(orderId, userId, 'order_confirmed');
    return this.fetchOrderOrThrow(orderId);
  }

  /**
   * PATCH /orders/:id/force-status — ручной обход матрицы админом (§3).
   * Требует reason; всё логируется в AuditLog, деньги двигаются теми же
   * escrow-методами (не «нарисованным» балансом).
   */
  async adminForceStatus(
    orderId: string,
    dto: UpdateOrderStatusDto,
    reason: string,
  ) {
    if (!reason || !reason.trim()) {
      throw new BadRequestException('reason обязателен для force-status');
    }
    const order = await this.fetchOrderOrThrow(orderId);
    if (!order) throw new NotFoundException('Заказ не найден');

    // D5: PAID ставится ТОЛЬКО подтверждением депозита (webhook/SYSTEM).
    // Прямая установка PAID не создаёт эскроу — такой заказ навсегда
    // застревает: cron фильтрует escrowStatus=HELD, релиз и возврат
    // невозможны, продавец не получит денег, покупатель — возврата.
    if (dto.status === OrderStatus.PAID) {
      throw new BadRequestException(
        'PAID выставляется только подтверждением депозита, а не вручную',
      );
    }

    if (dto.status === OrderStatus.COMPLETED) {
      const result = await this.escrowService.releaseEscrow(
        orderId,
        'admin_refund',
      );
      // D5: молчаливый no-op запрещён — если эскроу не в HELD (легаси-заказ,
      // сбой холда), фиксируем статус напрямую, чтобы админ видел результат,
      // а не «успех» без перехода.
      if (!result.released) {
        await this.prisma.order.update({
          where: { id: orderId },
          data: {
            status: OrderStatus.COMPLETED,
            completedAt: new Date(),
            autoCompleteAt: null,
          },
        });
      }
    } else if (dto.status === OrderStatus.REFUNDED) {
      // NH10 (вариант B, defense in depth): админ-возврат рекламного заказа
      // идёт не «в лоб» 100% рекламодателю, а тем же ad-aware путём, что и
      // арбитраж: `refundEscrow` сам распознаёт рекламу, вернёт только за
      // неотработанные дни показа и погасит объявление в одной транзакции.
      // Отдельная ветка не нужна — здесь только комментарий, чтобы связь
      // была явной при чтении.
      const result = await this.escrowService.refundEscrow(
        orderId,
        'admin_refund',
        100,
      );
      if (!result.refunded) {
        await this.prisma.order.update({
          where: { id: orderId },
          data: {
            status: OrderStatus.REFUNDED,
            cancelledAt: new Date(),
            cancelReason: 'admin_force_refund',
            autoCompleteAt: null,
          },
        });
        // NH10: эскроу уже закрыт (легаси/сбой холда), но объявление
        // рекламного заказа всё равно не должно висеть после возврата.
        await this.closeAdPostIfAny(order, 'admin_force_refund');
      }
    } else if (dto.status === OrderStatus.DISPUTED) {
      // NH10 (вариант B): спор на рекламном заказе запрещён и админу —
      // иначе он попадёт в NH8-очередь арбитража и вернёт деньги, оставив
      // объявление (ровно дыра NH10, только руками админа).
      if (order.post?.isAd) {
        throw new BadRequestException(
          'Рекламный заказ нельзя перевести в спор: используйте REFUNDED ' +
            '(возврат за неотработанные дни)',
        );
      }
      await this.prisma.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.DISPUTED, autoCompleteAt: null },
      });
      const deal = await this.prisma.deal.findFirst({
        where: { orderId },
        select: { id: true, dispute: true },
      });
      if (deal && deal.dispute !== 'RESOLVED') {
        await this.prisma.deal.update({
          where: { id: deal.id },
          data: { dispute: 'OPEN' },
        });
      }
    } else if (
      dto.status === OrderStatus.CANCELLED &&
      order.escrowStatus === EscrowStatus.HELD
    ) {
      // NH3: CANCELLED при живом эскроу — это возврат денег, а не смена
      // ярлыка. Прямая запись status=CANCELLED оставляла escrowStatus=HELD:
      // autoCloseOrders фильтрует PAID/SHIPPED (заказ не видит), матрица
      // CANCELLED:{} (переходов нет), арбитраж требует Deal.dispute=OPEN,
      // refundEscrow недоступен из терминального статуса → деньги висят
      // вечно. Гоним через refundEscrow: он вернёт средства покупателю,
      // закроет эскроу и выставит REFUNDED атомарно.
      const result = await this.escrowService.refundEscrow(
        orderId,
        'admin_refund',
        100,
      );
      if (!result.refunded) {
        // Эскроу не в HELD (легаси-заказ, сбой холда) — денег нет,
        // заказ можно закрыть напрямую.
        await this.prisma.order.update({
          where: { id: orderId },
          data: {
            status: OrderStatus.CANCELLED,
            cancelledAt: new Date(),
            cancelReason: reason,
            autoCompleteAt: null,
          },
        });
        // NH10: объявление рекламного заказа гасим и здесь — иначе отмена
        // без движения денег оставила бы его висеть в ленте бесплатно.
        await this.closeAdPostIfAny(order, reason);
      }
    } else if (dto.status === OrderStatus.SHIPPED) {
      // NH3: force-переход в SHIPPED осмысленен только из PAID и только при
      // живом эскроу. Из PENDING/CANCELLED/REFUNDED он не двигает деньги, но
      // создаёт «отправленный» заказ, которого нет в escrow-контуре, и
      // сбивает autoCloseOrders (фильтр PAID/SHIPPED + escrowStatus=HELD).
      if (
        order.status !== OrderStatus.PAID ||
        order.escrowStatus !== EscrowStatus.HELD
      ) {
        throw new BadRequestException(
          `force-status SHIPPED допустим только из PAID с эскроу HELD ` +
            `(сейчас ${order.status}/${order.escrowStatus})`,
        );
      }
      const autocompleteDays = await this.settings.getInt(
        'escrow_autocomplete_days',
        7,
      );
      await this.prisma.order.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.SHIPPED,
          shippedAt: new Date(),
          autoCompleteAt: addDays(new Date(), autocompleteDays),
        },
      });
    } else if (
      dto.status === OrderStatus.CANCELLED &&
      order.escrowStatus === EscrowStatus.NONE
    ) {
      // PENDING → CANCELLED: денег нет, эскроу не создан — безопасно.
      await this.prisma.order.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelReason: reason,
          autoCompleteAt: null,
        },
      });
    } else if (
      order.status === OrderStatus.PENDING &&
      order.escrowStatus === EscrowStatus.NONE
    ) {
      // NH3: единственный оставшийся безопасный случай — правка «ярлыка» на
      // заказе без движения денег (PENDING, escrow NONE). Матрица §3 для
      // PENDING допускает только CANCELLED (обработан выше), поэтому любой
      // другой статус здесь — бессмыслица, но денег не двигает. Разрешаем
      // с явным ограничением и логируем.
      await this.prisma.order.update({
        where: { id: orderId },
        data: { status: dto.status, autoCompleteAt: null },
      });
    } else {
      // NH3: остальное запрещено. Сюда попадают попытки выставить статус,
      // несовместимый с текущим состоянием денег (например, PENDING из
      // PAID/SHIPPED, CANCELLED из SHIPPED с HELD, любой статус поверх
      // уже закрытого эскроу). Раньше эта ветка молча писала status и
      // оставляла эскроу висеть — теперь отказ с причиной.
      throw new BadRequestException(
        `force-status ${order.status} → ${dto.status} запрещён: ` +
          `несовместим с escrowStatus=${order.escrowStatus}. ` +
          `Используйте REFUNDED/COMPLETED — деньги двигают escrow-методы`,
      );
    }

    await this.auditService.log({
      userId: undefined,
      action: 'order_force_status',
      entity: 'order',
      entityId: orderId,
      metadata: { from: order.status, to: dto.status, reason },
    });
    return this.fetchOrderOrThrow(orderId);
  }

  /** Делегат §4.3 — для вызовов из арбитража/админки. */
  async releaseEscrow(
    orderId: string,
    reason: EscrowCloseReason = 'arbitration',
  ) {
    return this.escrowService.releaseEscrow(orderId, reason);
  }

  /**
   * NH9: делегат закрытия РЕКЛАМНОГО заказа в пользу платформы (услуга
   * оказана — объявление показывается). См. EscrowService.settleAdSale.
   */
  async settleAdSale(
    orderId: string,
    reason: EscrowCloseReason = 'settle_ad_sale',
  ) {
    return this.escrowService.settleAdSale(orderId, reason);
  }

  /** Делегат §5.1 — полный или частичный (SPLIT) возврат. */
  async refundEscrow(
    orderId: string,
    reason: EscrowCloseReason = 'admin_refund',
    buyerSharePct = 100,
  ) {
    return this.escrowService.refundEscrow(orderId, reason, buyerSharePct);
  }

  /**
   * Cron авто-закрытия (§4.5).
   *  (a) PAID и продавец не отправил за 5 дней → возврат покупателю;
   *      НО рекламный заказ — исключение (NH9, КРИТ): см. settleIfAdOrder.
   *  (b) SHIPPED и покупатель не подтвердил за 7 дней → релиз продавцу.
   * DISPUTED в выборку не попадает: спор выставляет autoCompleteAt = null
   * (D1/D6), поэтому спорный заказ не может быть закрыт таймером, пока
   * арбитраж думает.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async autoCloseOrders() {
    const now = new Date();

    const notShipped = await this.prisma.order.findMany({
      where: {
        status: OrderStatus.PAID,
        autoCompleteAt: { lt: now },
        escrowStatus: 'HELD',
      },
      select: { id: true },
    });
    let refunded = 0;
    let adSettled = 0;
    for (const o of notShipped) {
      const ad = await this.settleIfAdOrder(o.id);
      if (ad) {
        adSettled++;
        continue;
      }
      await this.escrowService
        .refundEscrow(o.id, 'seller_no_ship_timeout', 100)
        .then(() => {
          refunded++;
        })
        .catch((err) =>
          this.logger.error(
            `autoClose refund ${o.id} failed: ${(err as Error).message}`,
          ),
        );
    }

    const notConfirmed = await this.prisma.order.findMany({
      where: {
        status: OrderStatus.SHIPPED,
        autoCompleteAt: { lt: now },
        escrowStatus: 'HELD',
      },
      select: { id: true },
    });
    let released = 0;
    for (const o of notConfirmed) {
      // NH9: рекламный заказ, дошедший до SHIPPED (админ перевёл вручную),
      // тоже не возвращаем — услуга оказана.
      const ad = await this.settleIfAdOrder(o.id);
      if (ad) {
        adSettled++;
        continue;
      }
      await this.escrowService
        .releaseEscrow(o.id, 'auto_timeout')
        .then(() => {
          released++;
        })
        .catch((err) =>
          this.logger.error(
            `autoClose release ${o.id} failed: ${(err as Error).message}`,
          ),
        );
    }

    const count = notShipped.length + notConfirmed.length;
    if (count > 0) {
      this.logger.log(
        `autoCloseOrders: refunded=${refunded}, released=${released}, adSettled=${adSettled}`,
      );
    }
    return { count };
  }

  /**
   * NH9 (КРИТ): рекламный заказ НЕ возвращаем по таймауту «продавец не
   * отгрузил».
   *
   * Реклама — услуга, и она оказана: объявление показывается. Продавец услуги —
   * платформа (`sellerId` = ADMIN), `platformFee` = вся сумма заказа, товара
   * нет и отгружать нечего. Возврат здесь давал рекламодателю все деньги на
   * 5-й день, а объявление продолжало висеть в ленте до `dto.days` — до 25
   * дней бесплатного показа, убыток `ad_price × (days − 5)`.
   *
   * Признак рекламного заказа — прямая связь `Order.post` (`Post.orderId`
   * @unique, заполняется в `PostsService.createAd`), а не эвристика
   * «sellerId == ADMIN»: админ может быть продавцом и обычного товара, а
   * связь однозначна и индексируется.
   *
   * @returns true — заказ рекламный и закрыт в пользу платформы; false —
   *          заказ не рекламный, вызывающий обрабатывает его как обычно.
   */
  private async settleIfAdOrder(orderId: string): Promise<boolean> {
    const adOrder = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, post: { select: { id: true, isAd: true } } },
    });
    if (!adOrder?.post?.isAd) return false;

    await this.escrowService
      .settleAdSale(orderId, 'settle_ad_sale')
      .catch((err) =>
        this.logger.error(
          `autoClose ad-settle ${orderId} failed: ${(err as Error).message}`,
        ),
      );
    return true;
  }

  /**
   * NH10: погасить объявление рекламного заказа, когда эскроу двигать уже
   * нечего (легаси-заказ / сбой холда), но объявление всё ещё активно.
   *
   * Основной ad-aware возврат делает `EscrowService.refundEscrow` — он гасит
   * объявление в той же транзакции, что и деньги. Этот хелпер закрывает
   * остаточный случай: `refundEscrow` вернул `refunded: false` (эскроу не в
   * HELD), а `Post.isPinned` при этом `true` — иначе объявление осталось бы в
   * ленте бесплатно после админского REFUNDED/CANCELLED.
   */
  private async closeAdPostIfAny(
    order: { id: string; post?: { id: string; isAd: boolean } | null },
    reason: string,
  ): Promise<void> {
    if (!order.post?.isAd) return;
    const closed = await this.prisma.post.updateMany({
      where: { orderId: order.id, isPinned: true },
      data: { isPinned: false, adExpireDate: new Date() },
    });
    if (closed.count > 0) {
      this.logger.warn(
        `NH10: рекламный заказ ${order.id} закрыт без движения эскроу (${reason}) — объявление погашено`,
      );
    }
  }

  /** Отмена неоплаченных заказов по TTL (§4.4, order_payment_ttl_minutes). */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async cancelExpiredOrders() {
    const ttlMinutes = await this.settings.getInt(
      'order_payment_ttl_minutes',
      15,
    );
    const now = new Date();
    const cutoff = addMinutes(now, -ttlMinutes);
    const oldestAllowed = addMinutes(now, -CANCEL_MAX_AGE_MINUTES);

    // L1-ФИКС (ДЕФЕКТ 2): отменяем только заказы, которые РЕАЛЬНО ждут оплату.
    //
    // Было: `status: PENDING, createdAt < cutoff` — любой старый PENDING
    // выкашивался за 30 секунд. На боевой БД это 654 легаси-заказа
    // (01.08.2026, статус восстанавливался из бэкапа/миграции): ветка
    // reconciler'а (б), возвращающая заказ в PENDING, сносила их за один тик.
    //
    // Стало (вариант «в» из ТЗ):
    //   (а) нижняя граница окна — `createdAt > now - CANCEL_MAX_AGE_MINUTES`.
    //       Всё, что старше суток, не может быть «ожиданием оплаты»: это
    //       импорт/бэкап/компенсация. Такие заказы не трогаем, но считаем и
    //       логируем — их должен разбирать reconciler, а не крон.
    //   (б) заказы со следами оплаты (`paidAt != null`) не «неоплаченные», а
    //       «сломанные»: отмена вернула бы деньги в никуда. Их тоже не трогаем.
    //   (в) штатный сценарий не меняется: создан → не оплачен → через TTL
    //       отменён (cutoff = now - 15 мин, окно 24 ч его покрывает).
    const baseWhere = {
      status: 'PENDING' as const,
      createdAt: { lt: cutoff },
    };

    // Диагностика: сколько старых PENDING мы НЕ трогаем (и почему).
    const [tooOld, paidMarked] = await Promise.all([
      this.prisma.order.count({
        where: { status: 'PENDING', createdAt: { lt: oldestAllowed } },
      }),
      this.prisma.order.count({
        where: { ...baseWhere, paidAt: { not: null } },
      }),
    ]);

    if (tooOld > 0) {
      this.logger.warn(
        `cancelExpiredOrders: пропущено ${tooOld} PENDING старше ` +
          `${CANCEL_MAX_AGE_MINUTES} мин — не трогаем историю/импорт ` +
          `(разбор за reconciler'ом, см. reconcileUnheldEscrow)`,
      );
    }
    if (paidMarked > 0) {
      this.logger.warn(
        `cancelExpiredOrders: пропущено ${paidMarked} PENDING со следом ` +
          `оплаты (paidAt != null) — это «сломанные» заказы, их разбирает reconciler`,
      );
    }

    const { count } = await this.prisma.order.updateMany({
      where: {
        ...baseWhere,
        createdAt: { lt: cutoff, gt: oldestAllowed },
        paidAt: null,
      },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });

    if (count > 0) {
      this.logger.log(`Отменено просроченных заказов: ${count}`);
    }

    return { count, skippedOld: tooOld, skippedPaid: paidMarked };
  }

  // ─── ФИКС 1: reconciler «PAID/SHIPPED + escrowStatus=NONE» ─────────────

  /**
   * Разбор «зависших» заказов: `status IN (PAID, SHIPPED)` при
   * `escrowStatus = NONE`.
   *
   * Как такие заказы появляются: `processSuccessfulPayment` делает два шага
   * неатомарно (D4) — сначала `PENDING → PAID`, потом `holdForOrder`. Если
   * процесс умер между шагами, а компенсация в `PENDING` тоже не доехала,
   * заказ остаётся PAID без холда. Его не видит **ни один** крон:
   * `autoCloseOrders` фильтрует `escrowStatus: HELD`, `cancelExpiredOrders` —
   * `status: PENDING`. Заказ висит вечно: деньги в блокчейне, эскроу нет.
   *
   * Классификация (обе ветки обязательны — что реально встречается, решает БД):
   *  - **(а)** есть `Transaction` с этим orderId и статусом
   *    `CONFIRMED | OVERPAID | SWEPT` → деньги пришли, холд не создан →
   *    досоздаём его `holdForOrder` (заказ уходит в HELD и живёт обычным путём);
   *  - **(б)** подтверждённой транзакции нет → деньги не пришли → возвращаем в
   *    `PENDING` (`paidAt: null`) — ровно компенсация из
   *    `processSuccessfulPayment`. Дальше заказ подберёт `cancelExpiredOrders`.
   *
   * ⚠️ РЕЖИМ ПО УМОЛЧАНИЮ — DRY-RUN. Реальный проход только при
   * `apply: true` ИЛИ настройке `escrow_reconcile_legacy_apply = 'true'`.
   * Причина: на живой БД таких заказов 654, и ветка (б) массово переводит их
   * в PENDING, откуда `cancelExpiredOrders` (30 сек) отменит их навсегда —
   * это необратимая мутация боевых данных. Рубильник вынесен наружу.
   *
   * Идемпотентность: холд — атомарный `updateMany({ escrowStatus: NONE })`
   * + unique refKey проводки; ветка (б) — `updateMany` с полным набором
   * условий (`status IN (...) AND escrowStatus = NONE`). Повторный прогон по
   * уже обработанным заказам не пишет ни строк.
   */
  async reconcileUnheldEscrow(
    opts: { apply?: boolean; batchSize?: number; orderIds?: string[] } = {},
  ): Promise<EscrowReconcileReport> {
    const settingOn =
      (await this.settings.get(ESCROW_RECONCILE_APPLY_SETTING)) === 'true';
    const apply = opts.apply ?? settingOn;
    const batchSize = Math.max(1, opts.batchSize ?? 100);

    const orders = await this.prisma.order.findMany({
      where: {
        status: { in: [OrderStatus.PAID, OrderStatus.SHIPPED] },
        escrowStatus: EscrowStatus.NONE,
        // Адресный прогон: когда передан список id, пачка ограничена им.
        // Нужно и админу («разобрать вот эти заказы»), и тестам — иначе
        // самый старый батч всегда составляют легаси-заказы 01.08, и ни
        // проверить, ни точечно починить что-то другое невозможно.
        ...(opts.orderIds?.length ? { id: { in: opts.orderIds } } : {}),
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: batchSize,
    });

    const report: EscrowReconcileReport = {
      apply,
      scanned: orders.length,
      held: 0,
      reverted: 0,
      failed: 0,
      withConfirmedTx: 0,
      withoutConfirmedTx: 0,
      orderIds: { held: [], reverted: [], failed: [] },
    };
    if (!orders.length) return report;

    const funded = new Set(
      (
        await this.prisma.transaction.findMany({
          where: {
            orderId: { in: orders.map((o) => o.id) },
            status: { in: FUNDED_TX_STATUSES },
          },
          select: { orderId: true },
        })
      ).map((t) => t.orderId),
    );

    const caseA: string[] = [];
    const caseB: string[] = [];
    for (const o of orders) (funded.has(o.id) ? caseA : caseB).push(o.id);
    report.withConfirmedTx = caseA.length;
    report.withoutConfirmedTx = caseB.length;

    if (!apply) {
      // Dry-run: только отчёт и алерт. НИ ОДНОЙ мутации.
      this.logger.error(
        `ALERT escrow reconcile (DRY-RUN): найдено ${report.scanned} заказов ` +
          `PAID/SHIPPED без холда — (а) с подтверждённым депозитом: ${caseA.length}, ` +
          `(б) без депозита (вернуть в PENDING): ${caseB.length}. ` +
          `Мутации НЕ выполнялись. Включение: ${ESCROW_RECONCILE_APPLY_SETTING}='true'.`,
      );
      return report;
    }

    // ---- случай (а): деньги пришли — досоздаём холд ----
    for (const orderId of caseA) {
      try {
        const before = await this.prisma.order.findUnique({
          where: { id: orderId },
          select: { status: true },
        });
        const hold = await this.escrowService.holdForOrder(orderId);
        if (!hold.held) continue;

        // Заказ уже был SHIPPED: holdForOrder выставил дедлайн «отправки»,
        // которого он уже не ждёт — переносим на срок авто-подтверждения.
        if (before?.status === OrderStatus.SHIPPED) {
          const days = await this.settings.getInt(
            'escrow_autocomplete_days',
            7,
          );
          await this.prisma.order.updateMany({
            where: { id: orderId, escrowStatus: EscrowStatus.HELD },
            data: { autoCompleteAt: addDays(new Date(), days) },
          });
        }

        report.held++;
        report.orderIds.held.push(orderId);
        this.logger.warn(
          `ALERT escrow reconcile: заказ ${orderId} был PAID/SHIPPED без холда, ` +
            `депозит подтверждён — холд досоздан на ${hold.amount} USDT`,
        );
      } catch (err) {
        report.failed++;
        report.orderIds.failed.push(orderId);
        this.logger.error(
          `escrow reconcile hold ${orderId} failed: ${(err as Error).message}`,
        );
      }
    }

    // ---- случай (б): денег нет — возвращаем в PENDING ----
    for (const orderId of caseB) {
      try {
        // Условия те же, что в компенсации processSuccessfulPayment, плюс
        // escrowStatus=NONE — иначе можно было бы снести холд, созданный
        // параллельно (webhook/другой прогон).
        const { count } = await this.prisma.order.updateMany({
          where: {
            id: orderId,
            status: { in: [OrderStatus.PAID, OrderStatus.SHIPPED] },
            escrowStatus: EscrowStatus.NONE,
          },
          data: { status: OrderStatus.PENDING, paidAt: null, shippedAt: null },
        });
        if (count === 0) continue;
        report.reverted++;
        report.orderIds.reverted.push(orderId);
      } catch (err) {
        report.failed++;
        report.orderIds.failed.push(orderId);
        this.logger.error(
          `escrow reconcile revert ${orderId} failed: ${(err as Error).message}`,
        );
      }
    }

    this.logger.warn(
      `ALERT escrow reconcile (APPLY): scanned=${report.scanned}, ` +
        `held=${report.held}, reverted=${report.reverted}, failed=${report.failed}`,
    );

    return report;
  }

  /**
   * Крон reconciler'а. Периодичность — 10 минут (не чаще раза в час, как
   * требует ТЗ):
   *  - 5 минут (`autoCloseOrders`) избыточно: у `PAID + NONE` нет таймера
   *    (`autoCompleteAt = NULL`), окно эскроу измеряется днями
   *    (`escrow_ship_deadline_days = 5`), а не минутами;
   *  - 10 минут — тот же класс задач, что `reconcilePayouts` и
   *    `runInvariantCheck` («догнать состояние с внешним миром»), одинаковая
   *    нагрузка на БД;
   *  - пачка ограничена `batchSize` (100) — на 654 легаси-заказах это 7
   *    прогонов вместо одного тяжёлого findMany с N транзакциями.
   *
   * Крон всегда работает в режиме, который задаёт настройка. Пока ключа
   * `escrow_reconcile_legacy_apply` нет — это безопасный dry-run.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async reconcileUnheldEscrowCron(): Promise<{ scanned: number }> {
    try {
      const report = await this.reconcileUnheldEscrow();
      return { scanned: report.scanned };
    } catch (err) {
      this.logger.error(
        `escrow reconcile cron failed: ${(err as Error).message}`,
      );
      return { scanned: 0 };
    }
  }

  // ─── внутреннее ────────────────────────────────────────────────────────

  /**
   * NH8: покупатель отзывает спор («оставляю как есть»).
   *
   * Заказ возвращается в SHIPPED, таймер авто-подтверждения перезапускается —
   * иначе заказ с escrow HELD оставался бы в DISPUTED без таймера и без
   * арбитра (Deal-то нет), то есть замер навсегда.
   *
   * Арбитраж вызывать не нужно: он видит только `Order.status = 'DISPUTED'`,
   * а после отзыва заказ снова SHIPPED и идёт обычным путём (confirmReceipt или
   * авто-релиз по таймауту).
   */
  async resolveDispute(orderId: string, userId: string) {
    const order = await this.fetchOrderOrThrow(orderId);
    if (order.buyerId !== userId) {
      throw new ForbiddenException('Отозвать спор может только покупатель');
    }
    if (order.status !== OrderStatus.DISPUTED) {
      throw new BadRequestException(
        `Отозвать спор можно только из DISPUTED (сейчас ${order.status})`,
      );
    }

    const autocompleteDays = await this.settings.getInt(
      'escrow_autocomplete_days',
      7,
    );
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.SHIPPED,
        autoCompleteAt: addDays(new Date(), autocompleteDays),
        cancelReason: null,
      },
    });

    await this.audit(orderId, userId, 'order_dispute_withdrawn');
    return updated;
  }

  private assertOwner(
    order: { buyerId: string; sellerId: string },
    userId: string,
    actor: Actor,
  ): void {
    if (actor === 'SELLER' && order.sellerId !== userId) {
      throw new ForbiddenException('Это не ваш заказ');
    }
    if (actor === 'BUYER' && order.buyerId !== userId) {
      throw new ForbiddenException('Это не ваш заказ');
    }
  }

  private async audit(orderId: string, userId: string, action: string) {
    await this.auditService.log({
      userId,
      action,
      entity: 'order',
      entityId: orderId,
    });
  }
}
