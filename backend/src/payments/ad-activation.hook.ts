import { Injectable, Logger } from '@nestjs/common';

/**
 * NH5-ad: DI-мост «депозит подтверждён → активировать рекламу».
 *
 * Дыра (verify4/report.md, NH5-ad): `PostsService.createAd` вызывал
 * `paymentsService.processSuccessfulPayment(order.id)` сразу при создании
 * заказа на рекламу — до депозита. Заказ становился PAID + escrowStatus HELD
 * без единого цента в блокчейне, реклама активировалась, а через 5 дней
 * `autoCloseOrders` возвращал покупателю (самому рекламодателю) escrowAmount
 * на AVAILABLE → вывод реальных USDT в BSC. Минт до ad_price × days.
 *
 * Теперь активация рекламы — реакция на РЕАЛЬНОЕ подтверждение оплаты:
 * `PaymentsService.processSuccessfulPayment` (вызывается только из webhook
 * депозита paymod и легаси-IPN с проверенной суммой) после успешного холда
 * дёргает этот хук.
 *
 * Модулей-циклов нет: PostsModule уже импортирует PaymentsModule, поэтому
 * мост живёт здесь, а PostsService лишь регистрирует свою реализацию в
 * `onModuleInit` (posts → payments, обратной зависимости нет).
 */
export type AdActivationFn = (orderId: string) => Promise<boolean>;

@Injectable()
export class AdActivationHook {
  private readonly logger = new Logger(AdActivationHook.name);
  private fn: AdActivationFn | null = null;

  register(fn: AdActivationFn): void {
    this.fn = fn;
  }

  /** true — реклама активирована этим вызовом (idempotent-путь вернёт false). */
  async trigger(orderId: string): Promise<boolean> {
    if (!this.fn) {
      this.logger.warn(
        `ad activation hook not registered, order ${orderId} left unactivated`,
      );
      return false;
    }
    return this.fn(orderId);
  }
}