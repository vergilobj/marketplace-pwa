import { EscrowStatus, OrderStatus } from '@prisma/client';
import { ArbitrageService } from './arbitrage.service';

/** NH6: см. ниже. Тип вердикта локально, чтобы не экспортировать приватный. */
type ParsedVerdictLike = { verdict: string; confidence: number; note: string };

/**
 * NH6: провал settlement в арбитраже раньше запирал эскроу навсегда.
 *
 * Старый порядок: Deal.dispute='RESOLVED' → settleEscrow(...) с catch,
 * который только логировал. Падение release/refund оставляло Order в
 * DISPUTED + HELD: autoCloseOrders фильтрует PAID/SHIPPED, матрица DISPUTED
 * пуста, арбитраж дело уже не берёт → деньги заморожены без пути возврата.
 *
 * Новый порядок: settleEscrow вызывается ДО фиксации вердикта и ошибку
 * пробрасывает — Deal остаётся OPEN, cron повторит.
 */
describe('NH6: арбитраж не запирает эскроу', () => {
  const order = {
    id: 'order-1',
    status: OrderStatus.DISPUTED,
    amount: 1000,
    escrowStatus: EscrowStatus.HELD,
  };

  const deal = {
    id: 'deal-1',
    buyerId: 'buyer-1',
    sellerId: 'seller-1',
    cashPrice: null,
    order,
  };

  const mkService = (settle: jest.Mock) => {
    const prisma = {
      deal: {
        findUnique: jest.fn().mockResolvedValue(deal),
        update: jest.fn().mockResolvedValue({}),
      },
      order: { update: jest.fn().mockResolvedValue({}) },
    };
    const escrow = {
      releaseEscrow: settle,
      refundEscrow: settle,
    };
    const service = new ArbitrageService(
      prisma as any,
      {} as any,
      {} as any,
      escrow as any,
    );
    // executeVerdict приватный — дёргаем через bracket, чтобы не тащить
    // NestJS DI ради двух моков.
    const call = (v: ParsedVerdictLike) =>
      (service as any).executeVerdict('deal-1', v);
    return { service, prisma, call };
  };

  it('сначала двигает деньги, потом фиксирует вердикт (порядок вызовов)', async () => {
    const calls: string[] = [];
    const settle = jest.fn().mockImplementation(() => {
      calls.push('settle');
    });
    const { prisma, call } = mkService(settle);
    prisma.deal.update.mockImplementation(() => {
      calls.push('markResolved');
    });

    await call({ verdict: 'BUYER_RIGHT', confidence: 1, note: 'n' });

    expect(calls).toEqual(['settle', 'markResolved']);
    expect(prisma.deal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ dispute: 'RESOLVED' }),
      }),
    );
  });

  it('падение settlement НЕ фиксирует вердикт и пробрасывает ошибку', async () => {
    const settle = jest.fn().mockRejectedValue(new Error('db down'));
    const { prisma, call } = mkService(settle);

    await expect(
      call({ verdict: 'SELLER_RIGHT', confidence: 1, note: 'n' }),
    ).rejects.toThrow('db down');

    // Deal НЕ помечен RESOLVED — арбитраж возьмёт его снова.
    expect(prisma.deal.update).not.toHaveBeenCalled();
  });

  it('заказ не в HELD — деньги не двигаем (нечего), вердикт фиксируется', async () => {
    const settle = jest.fn();
    const { service, prisma } = mkService(settle);
    prisma.deal.findUnique.mockResolvedValue({
      ...deal,
      order: { ...order, escrowStatus: EscrowStatus.NONE },
    });

    await (service as any).executeVerdict('deal-1', {
      verdict: 'BUYER_RIGHT',
      confidence: 1,
      note: 'n',
    });

    expect(settle).not.toHaveBeenCalled();
    expect(prisma.deal.update).toHaveBeenCalled();
  });

  it('resolveDisputes не трогает дело, помеченное NEED_ADMIN', async () => {
    const prisma = {
      deal: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'deal-1', disputeNote: 'NEED_ADMIN', buyerId: 'b-1' },
          ]),
        update: jest.fn(),
      },
    };
    const apiClient = { complete: jest.fn() };
    const service = new ArbitrageService(
      prisma as any,
      apiClient as any,
      {} as any,
      {} as any,
    );

    await service.resolveDisputes();

    expect(apiClient.complete).not.toHaveBeenCalled();
    expect(prisma.deal.update).not.toHaveBeenCalled();
  });
});
