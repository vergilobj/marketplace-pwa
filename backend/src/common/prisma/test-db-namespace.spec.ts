/**
 * L1-ФИКС (ДЕФЕКТ 1): синхронность namespace'ов.
 *
 * Глобальный teardown (test/jest-global-teardown.ts) чистит тестовую БД по
 * списку ALL_TEST_PHONE_PREFIXES. Если спека заводит новый namespace, а список
 * не обновили — остатки упавшей спеки никто не уберёт, и следующий прогон
 * стартует на грязной БД.
 *
 * Тест статически сканирует исходники спек и требует, чтобы каждый
 * phone-литерал (или значение `suffix`, из которого он собирается) начинался с
 * одного из зарегистрированных префиксов.
 */
import * as fs from 'fs';
import * as path from 'path';
import { ALL_TEST_PHONE_PREFIXES } from './test-db-cleanup';

const BACKEND_DIR = path.resolve(__dirname, '../../..');

/**
 * Все спеки: src/**\/*.spec.ts + test/*.e2e-spec.ts
 *
 * В анализ берём ТОЛЬКО спеки, которые реально пишут в БД — т.е. создают
 * `new PrismaService()` (мок-prisma юниты вроде orders.service.spec.ts
 * используют фейковые телефоны `+7999` и до базы не доходят).
 */
function collectSpecFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(spec|e2e-spec)\.ts$/.test(e.name)) out.push(full);
    }
  };
  walk(path.join(BACKEND_DIR, 'src'));
  walk(path.join(BACKEND_DIR, 'test'));
  return out.filter((f) => {
    const src = fs.readFileSync(f, 'utf8');
    // Реальный доступ к БД: либо PrismaService, либо AppModule (e2e).
    return (
      /new PrismaService\(/.test(src) || /imports:\s*\[AppModule\]/.test(src)
    );
  });
}

/**
 * Достаём «литеральные зачатки» namespace'ов:
 *   phone: `g1b-money-${suffix}`   → 'g1b-money-'
 *   phone: 'l1-cancel-x'           → 'l1-cancel-x'
 *   const suffix = `nh9-${...}`    → 'nh9-'
 *   const PREFIX = 'g3-test-'      → 'g3-test-'
 */
function extractNamespaces(src: string): string[] {
  const found = new Set<string>();
  const push = (raw: string) => {
    // обрезаем всё, что начинается с интерполяции
    const lit = raw.split('${')[0];
    if (!lit || lit.length === 0) return;
    // Настоящие телефонные литералы (`+7999...`, `+0000000000`) — это
    // «пробы» на несуществующего пользователя в тестах логина/404, а не
    // namespace тестовых данных. Namespace в проекте всегда тег вида `tag-`.
    if (lit.startsWith('+')) return;
    found.add(lit);
  };

  const patterns = [
    /phone:\s*`([^`]*)`/g,
    /phone:\s*'([^']*)'/g,
    /phone:\s*"([^"]*)"/g,
    /const\s+(?:suffix|SUFFIX|PREFIX|PREFIXES)\s*=\s*`([^`]*)`/g,
    /const\s+(?:suffix|SUFFIX|PREFIX)\s*=\s*'([^']*)'/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) push(m[1]);
  }
  return [...found];
}

describe('L1: namespace-префиксы спек зарегистрированы в ALL_TEST_PHONE_PREFIXES', () => {
  it('каждый phone-namespace покрыт списком уборки', () => {
    const uncovered: string[] = [];

    for (const file of collectSpecFiles()) {
      const src = fs.readFileSync(file, 'utf8');
      for (const ns of extractNamespaces(src)) {
        const covered = ALL_TEST_PHONE_PREFIXES.some(
          (p) => ns.startsWith(p) || p.startsWith(ns),
        );
        if (!covered) {
          uncovered.push(`${path.relative(BACKEND_DIR, file)} → "${ns}"`);
        }
      }
    }

    expect(uncovered).toEqual([]);
  });

  it('в списке нет дублей и все префиксы ≥3 символов', () => {
    expect(new Set(ALL_TEST_PHONE_PREFIXES).size).toBe(
      ALL_TEST_PHONE_PREFIXES.length,
    );
    for (const p of ALL_TEST_PHONE_PREFIXES) {
      expect(p.length).toBeGreaterThanOrEqual(3);
    }
  });
});