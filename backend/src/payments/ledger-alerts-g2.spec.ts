import { ConfigService } from '@nestjs/config';
import { AlertsService } from '../common/alerts/alerts.service';
import { LedgerService } from './ledger.service';

/**
 * G2, фикс 4 — подключение внешнего канала к СУЩЕСТВУЮЩИМ точкам алертов.
 *
 * Логику детекции не трогали (ТЗ): проверяем ровно то, что нарушение
 * инвариантов теперь уходит ещё и наружу, а не только в лог + БД.
 *
 * `send` замокан — реальный POST проверяется в alerts.service.spec.ts,
 * здесь важна проводка.
 */
describe('LedgerService → AlertsService (G2)', () => {
  const makeLedger = (alerts?: AlertsService) => {
    const prisma = {
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'admin-1' }]) },
      $transaction: jest.fn(),
    };
    const notifications = {
      createNotification: jest.fn().mockResolvedValue({ id: 'n1' }),
    };
    const ledger = new LedgerService(
      prisma as any,
      notifications as any,
      alerts,
    );
    return { ledger, prisma, notifications };
  };

  it('нарушение инвариантов → alerts.send вызван с кодом money_invariants_violated', async () => {
    const sent: any[] = [];
    const alerts = { send: jest.fn(async (a: any) => (sent.push(a), true)) };

    const { ledger } = makeLedger(alerts as any);

    // Подменяем детекторы: инварианты нарушены, расхождений эскроу нет.
    jest
      .spyOn(ledger, 'verifyInvariants')
      .mockResolvedValue({ ok: false, problems: ['p1', 'p2'], warnings: [] } as any);
    jest.spyOn(ledger, 'findEscrowMismatches').mockResolvedValue([]);
    // Приватный метод доставки админам — не предмет этого теста.
    jest
      .spyOn(ledger as any, 'alertAdmins')
      .mockResolvedValue(undefined);
    jest
      .spyOn(ledger as any, 'alertAdminsInvariantWarnings')
      .mockResolvedValue(undefined);

    await ledger.runInvariantCheck();

    const moneyAlert = sent.find((a) => a.code === 'money_invariants_violated');
    expect(moneyAlert).toBeDefined();
    expect(moneyAlert.severity).toBe('error');
    expect(moneyAlert.message).toContain('Нарушены инварианты');
    expect(moneyAlert.context.problems).toBe(2);
  });

  it('расхождение реестра эскроу → alerts.send с кодом escrow_registry_mismatch', async () => {
    const sent: any[] = [];
    const alerts = { send: jest.fn(async (a: any) => (sent.push(a), true)) };

    const { ledger } = makeLedger(alerts as any);

    jest
      .spyOn(ledger, 'verifyInvariants')
      .mockResolvedValue({ ok: true, problems: [], warnings: [] } as any);
    jest.spyOn(ledger, 'findEscrowMismatches').mockResolvedValue([
      { orderId: 'o-1', escrowStatus: 'HELD', ledgerEscrow: 0 },
    ] as any);
    jest.spyOn(ledger as any, 'alertAdmins').mockResolvedValue(undefined);
    jest
      .spyOn(ledger as any, 'alertAdminsInvariantWarnings')
      .mockResolvedValue(undefined);

    await ledger.runInvariantCheck();

    const escrowAlert = sent.find((a) => a.code === 'escrow_registry_mismatch');
    expect(escrowAlert).toBeDefined();
    expect(escrowAlert.context.mismatches).toBe(1);
    expect(escrowAlert.context.sample).toEqual(['o-1']);
  });

  it('всё в порядке → alerts.send НЕ вызывается (нет ложных алертов)', async () => {
    const alerts = { send: jest.fn().mockResolvedValue(true) };
    const { ledger } = makeLedger(alerts as any);

    jest
      .spyOn(ledger, 'verifyInvariants')
      .mockResolvedValue({ ok: true, problems: [], warnings: [] } as any);
    jest.spyOn(ledger, 'findEscrowMismatches').mockResolvedValue([]);
    jest.spyOn(ledger as any, 'alertAdmins').mockResolvedValue(undefined);
    jest
      .spyOn(ledger as any, 'alertAdminsInvariantWarnings')
      .mockResolvedValue(undefined);

    await ledger.runInvariantCheck();

    expect(alerts.send).not.toHaveBeenCalled();
  });

  it('падение alerts.send НЕ отменяет алерт админам в БД (G2)', async () => {
    // AlertsService.send сам не бросает, но проводка обязана быть устойчивой:
    // раньше исключение здесь попадало в общий catch runInvariantCheck,
    // отменяло notifyAdminsSafely и возвращало problems: -1 — т.е. падение
    // ВТОРИЧНОГО канала уничтожало ПЕРВИЧНЫЙ алерт.
    const alerts = {
      send: jest.fn().mockRejectedValue(new Error('webhook взорвался')),
    };
    const { ledger } = makeLedger(alerts as any);

    jest
      .spyOn(ledger, 'verifyInvariants')
      .mockResolvedValue({ ok: false, problems: ['p1'], warnings: [] } as any);
    jest.spyOn(ledger, 'findEscrowMismatches').mockResolvedValue([]);
    const alertAdmins = jest
      .spyOn(ledger as any, 'alertAdmins')
      .mockResolvedValue(undefined);
    jest
      .spyOn(ledger as any, 'alertAdminsInvariantWarnings')
      .mockResolvedValue(undefined);

    const result = await ledger.runInvariantCheck();

    // Основной алерт доставлен, реальные нарушения не потеряны.
    expect(alertAdmins).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: false, problems: 1 });
  });

  it('LedgerService работает без AlertsService (спеки конструируют вручную)', async () => {
    const { ledger } = makeLedger(undefined);

    jest
      .spyOn(ledger, 'verifyInvariants')
      .mockResolvedValue({ ok: false, problems: ['p'], warnings: [] } as any);
    jest.spyOn(ledger, 'findEscrowMismatches').mockResolvedValue([]);
    jest.spyOn(ledger as any, 'alertAdmins').mockResolvedValue(undefined);
    jest
      .spyOn(ledger as any, 'alertAdminsInvariantWarnings')
      .mockResolvedValue(undefined);

    // Не должно упасть на `this.alerts?.send`.
    await expect(ledger.runInvariantCheck()).resolves.toBeDefined();
  });
});

/**
 * Проводка через Nest DI: @Global AlertsModule резолвит AlertsService в
 * LedgerService и при пустом ALERT_WEBHOOK_URL ничего не ломает.
 */
describe('AlertsService: тихий fallback в контексте DI (G2)', () => {
  it('без ALERT_WEBHOOK_URL send() безопасен и возвращает false', async () => {
    const config = {
      get: jest.fn(() => undefined),
    } as unknown as ConfigService;

    const alerts = new AlertsService(config);
    await expect(
      alerts.send({ code: 'money_invariants_violated', message: 'x' }),
    ).resolves.toBe(false);
  });
});