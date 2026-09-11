import { EscrowStatus, OrderStatus } from '@prisma/client';
import {
  ArbitrageService,
  ORDER_ESCALATED_MARKER,
  ORDER_RETRY_MARKER,
  VERDICT_MARKER,
} from './arbitrage.service';

/**
 * NH8 (verify5/report.md §4): спор по заказу БЕЗ Deal не доходил до арбитража.
 *
 * Заказ маркетплейса создаётся без `dealId` (`OrdersService.create`), поэтому
 * `Order.status = DISPUTED` не выставлял `Deal.dispute = 'OPEN'`, а арбитраж
 * искал только по Deal. Итог: escrow HELD висел без вердикта, автоматического
 * пути закрытия не было (только adminForceStatus руками).
 *
 * Фикс (вариант A): `resolveDisputes` дополнительно читает
 * `Order.status = 'DISPUTED'` + `escrowStatus = HELD` + без сделки
 * (`deals: { none: {} }`) и арбитрирует такой заказ по данным заказа.
 * Прогресс/эскалация — в `Order.cancelReason` (схему не трогаем).
 *
 * Deal-путь (NH6, `arbitrage-nh6.spec.ts`) при этом не меняется — здесь
 * проверяем, что он по-прежнему вызывается и что дублирования нет.
 */
describe('NH8: арбитраж по заказу без Deal', () => {
  const verdictJson = (v: string, confidence = 0.95) =>
    JSON.stringify({ verdict: v, confidence, note: 'ok' });

  const orderNoDeal = {
    id: 'order-1',
    buyerId: 'buyer-1',
    sellerId: 'seller-1',
    amount: 1000,
    status: OrderStatus.DISPUTED,
    escrowStatus: EscrowStatus.HELD,
    escrowAmount: 1000,
    cancelReason: null,
    paidAt: new Date('2026-09-01T00:00:00Z'),
    createdAt: new Date('2026-09-01T00:00:00Z'),
    product: { id: 'p-1', title: 'Товар', description: 'Описание' },
    deals: [],
  };

  const mk = (over: {
    orderFindMany?: jest.Mock;
    dealFindMany?: jest.Mock;
    orderFindUnique?: jest.Mock;
    complete?: jest.Mock;
    refund?: jest.Mock;
    release?: jest.Mock;
  } = {}) => {
    const orderFindMany =
      over.orderFindMany ??
      jest.fn().mockResolvedValue([{ id: 'order-1', cancelReason: null }]);
    const dealFindMany = over.dealFindMany ?? jest.fn().mockResolvedValue([]);
    const orderFindUnique =
      over.orderFindUnique ?? jest.fn().mockResolvedValue(orderNoDeal);
    const orderUpdate = jest.fn().mockResolvedValue({});
    const dealUpdate = jest.fn().mockResolvedValue({});

    const prisma = {
      deal: { findMany: dealFindMany, update: dealUpdate },
      order: {
        findMany: orderFindMany,
        findUnique: orderFindUnique,
        update: orderUpdate,
      },
    };
    const complete = over.complete ?? jest.fn();
    const escrow = {
      refundEscrow: over.refund ?? jest.fn().mockResolvedValue({ refunded: true }),
      releaseEscrow: over.release ?? jest.fn().mockResolvedValue({ released: true }),
    };

    const service = new ArbitrageService(
      prisma as any,
      { complete } as any,
      {} as any,
      escrow as any,
    );
    return { service, prisma, complete, escrow, orderUpdate, dealUpdate };
  };

  it('находит спор по заказу без Deal и выносит вердикт (BUYER_RIGHT → возврат)', async () => {
    const refund = jest.fn().mockResolvedValue({ refunded: true });
    const { service, complete, orderUpdate } = mk({
      complete: jest
        .fn()
        .mockResolvedValue({ text: verdictJson('BUYER_RIGHT') }),
      refund,
    });

    await service.resolveDisputes();

    // 1. Арбитр реально запущен по данным заказа (LLM вызван).
    expect(complete).toHaveBeenCalledTimes(1);

    // 2. Деньги двинуты: полный возврат покупателю.
    expect(refund).toHaveBeenCalledWith('order-1', 'arbitration_buyer_right', 100);

    // 3. Вердикт зафиксирован в cancelReason тем же контрактом, что payments
    //    читает из Deal.disputeNote.
    const verdictCall = orderUpdate.mock.calls.find((c) =>
      String(c[0]?.data?.cancelReason ?? '').startsWith(VERDICT_MARKER),
    );
    expect(verdictCall).toBeTruthy();
    const parsed = JSON.parse(
      String(verdictCall![0].data.cancelReason).slice(VERDICT_MARKER.length),
    );
    expect(parsed).toMatchObject({
      verdict: 'BUYER_RIGHT',
      splitPct: 100,
      refundAmount: 1000,
      source: 'order_no_deal',
    });
  });

  it('SELLER_RIGHT → релиз продавцу, Order не отменяется', async () => {
    const release = jest.fn().mockResolvedValue({ released: true });
    const { service, orderUpdate } = mk({
      complete: jest
        .fn()
        .mockResolvedValue({ text: verdictJson('SELLER_RIGHT') }),
      release,
    });

    await service.resolveDisputes();

    expect(release).toHaveBeenCalledWith('order-1', 'arbitration');
    expect(
      orderUpdate.mock.calls.some((c) =>
        String(c[0]?.data?.cancelReason ?? '').startsWith(VERDICT_MARKER),
      ),
    ).toBe(true);
  });

  it('уверенность ниже порога → счётчик попыток, деньги не двигаются', async () => {
    const refund = jest.fn();
    const { service, orderUpdate } = mk({
      complete: jest
        .fn()
        .mockResolvedValue({ text: verdictJson('BUYER_RIGHT', 0.3) }),
      refund,
    });

    await service.resolveDisputes();

    expect(refund).not.toHaveBeenCalled();
    expect(orderUpdate).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { cancelReason: `${ORDER_RETRY_MARKER}1` },
    });
  });

  it('MAX_ATTEMPTS исчерпан → эскалация админу без вызова LLM', async () => {
    const complete = jest.fn();
    const { service, orderUpdate } = mk({
      orderFindMany: jest
        .fn()
        .mockResolvedValue([{ id: 'order-1', cancelReason: `${ORDER_RETRY_MARKER}3` }]),
      complete,
    });

    await service.resolveDisputes();

    expect(complete).not.toHaveBeenCalled();
    expect(orderUpdate).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { cancelReason: ORDER_ESCALATED_MARKER },
    });
  });

  it('заказ СО сделкой не арбитрируется в order-очереди (нет дубля к deal-пути)', async () => {
    const complete = jest.fn();
    const { service, orderUpdate } = mk({
      orderFindUnique: jest.fn().mockResolvedValue({
        ...orderNoDeal,
        deals: [{ id: 'deal-1' }],
      }),
      complete,
    });

    await service.resolveDisputes();

    expect(complete).not.toHaveBeenCalled();
    expect(orderUpdate).not.toHaveBeenCalled();
  });

  it('падение settlement не рушит cron и не фиксирует вердикт', async () => {
    const refund = jest.fn().mockRejectedValue(new Error('escrow down'));
    const { service, orderUpdate, dealUpdate } = mk({
      complete: jest
        .fn()
        .mockResolvedValue({ text: verdictJson('BUYER_RIGHT') }),
      refund,
    });

    // Ошибка проглатывается на уровне очереди — cron не падает.
    await expect(service.resolveDisputes()).resolves.toBeUndefined();

    // Deal-путь при этом отработал штатно (своих дел нет).
    expect(dealUpdate).not.toHaveBeenCalled();

    // Вердикт НЕ зафиксирован — заказ остаётся DISPUTED + HELD, cron повторит.
    expect(
      orderUpdate.mock.calls.some((c) =>
        String(c[0]?.data?.cancelReason ?? '').startsWith(VERDICT_MARKER),
      ),
    ).toBe(false);
  });

  it('deal-путь (NH6) не сломан: оба прохода выполняются', async () => {
    const dealFindMany = jest
      .fn()
      .mockResolvedValue([
        { id: 'deal-1', buyerId: 'buyer-1', dispute: 'OPEN', disputeNote: null },
      ]);
    const orderFindMany = jest
      .fn()
      .mockResolvedValue([{ id: 'order-1', cancelReason: null }]);
    const complete = jest
      .fn()
      .mockResolvedValue({ text: verdictJson('BUYER_RIGHT') });
    const refund = jest.fn().mockResolvedValue({ refunded: true });

    const prisma = {
      deal: {
        findMany: dealFindMany,
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
      order: {
        findMany: orderFindMany,
        // deal-путь читает Deal с order; order-путь — Order без сделки.
        findUnique: jest.fn().mockResolvedValue(orderNoDeal),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const service = new ArbitrageService(
      prisma as any,
      { complete } as any,
      // DealService.thread — единственное, что нужно deal-пути от deals
      { thread: jest.fn().mockResolvedValue({ messages: [] }) } as any,
      { refundEscrow: refund, releaseEscrow: jest.fn() } as any,
    );

    await service.resolveDisputes();

    expect(dealFindMany).toHaveBeenCalled();
    expect(orderFindMany).toHaveBeenCalled();
  });
});