/**
 * L1-ФИКС (ДЕФЕКТ 1): namespace-guard уборки тестовых данных.
 *
 * Guard обязан отказываться работать с «широкими» префиксами и не давать
 * удалять чужие (боевые) строки, если тесты случайно идут против боевой БД.
 *
 * Тесты синтетические: проверяем сам guard, а не удаление. В изолированном
 * режиме (TEST_DATABASE_URL) `filterOwnOrderIds` пропускает всё — это тоже
 * проверяем (в изоляции чужих данных в принципе нет).
 */
import { PrismaService } from './prisma.service';
import {
  assertSafePrefixes,
  filterOwnOrderIds,
  isIsolatedTestDb,
  BULK_ABORT_THRESHOLD,
} from './test-db-cleanup';

describe('L1: namespace-guard уборки тестовых данных', () => {
  const prisma = new PrismaService();

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('assertSafePrefixes', () => {
    it('пропускает нормальные префиксы', () => {
      expect(() => assertSafePrefixes(['g1b-', 'nh9-', 'l1-'])).not.toThrow();
    });

    it('падает на пустом префиксе', () => {
      expect(() => assertSafePrefixes([''])).toThrow(/небезопасный/);
    });

    it('падает на слишком коротком префиксе (матчил бы боевые телефоны)', () => {
      expect(() => assertSafePrefixes(['+'])).toThrow(/небезопасный/);
      expect(() => assertSafePrefixes(['a'])).toThrow(/небезопасный/);
    });

    it('не падает на пустом списке', () => {
      expect(() => assertSafePrefixes([])).not.toThrow();
    });
  });

  describe('filterOwnOrderIds', () => {
    it('отбрасывает чужие orderId в не-изолированном режиме', async () => {
      if (isIsolatedTestDb()) {
        // В изоляции чужих данных нет — проверяем пропуск.
        const res = await filterOwnOrderIds(prisma, ['any-id'], ['u1']);
        expect(res.own).toEqual(['any-id']);
        expect(res.foreign).toEqual([]);
        return;
      }
      // Не-изолированный режим: боевой заказ с чужими buyer/seller
      // не должен попасть в список на удаление.
      const foreign = await prisma.order.findFirst({
        where: { status: 'COMPLETED' },
        select: { id: true },
      });
      if (!foreign) return; // нечего проверять
      const res = await filterOwnOrderIds(
        prisma,
        [foreign.id],
        ['definitely-not-the-buyer'],
      );
      expect(res.foreign).toContain(foreign.id);
      expect(res.own).not.toContain(foreign.id);
    });

    it('считает «своими» несуществующие id (удалять нечего)', async () => {
      const res = await filterOwnOrderIds(
        prisma,
        ['00000000-0000-0000-0000-000000000000'],
        [],
      );
      expect(res.own).toContain('00000000-0000-0000-0000-000000000000');
    });

    it('пустой список — no-op', async () => {
      const res = await filterOwnOrderIds(prisma, [], []);
      expect(res).toEqual({ own: [], foreign: [] });
    });
  });

  it('порог массового прерывания задан', () => {
    expect(BULK_ABORT_THRESHOLD).toBeGreaterThan(10);
  });
});