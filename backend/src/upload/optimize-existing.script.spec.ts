import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, statSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

/**
 * PERF-3: спека на одноразовый batch-скрипт `scripts/optimize-existing.ts`.
 *
 * Скрипт перезаписывает БОЕВЫЕ фото на проде, поэтому его свойства безопасности
 * должны быть зафиксированы тестом, а не «мы посмотрели руками»:
 *   - оригинал уезжает в uploads_orig_backup ПЕРЕД подменой;
 *   - повторный прогон НЕ пересжимает уже обработанное (иначе качество
 *     деградирует на ~5% за каждый запуск);
 *   - мелкие файлы (<= 1600px и <= 300 КБ) не трогаются;
 *   - видео не открывается вообще;
 *   - dry-run не пишет на диск.
 *
 * Запускаем РЕАЛЬНЫЙ CLI через ts-node — так проверяются и разбор аргументов,
 * и работа с файловой системой, а не только внутренняя логика.
 */
const BACKEND = resolve(__dirname, '..', '..');
const SCRIPT = join(BACKEND, 'scripts', 'optimize-existing.ts');

function hasSharp(): boolean {
  try {
    require('sharp');
    return true;
  } catch {
    return false;
  }
}
const SHARP = hasSharp();

/** Готовим шумовую картинку заданного размера (однотонные сжимаются слишком хорошо). */
async function makeNoise(path: string, w: number, h: number, ext: '.jpg' | '.png', quality: number) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const sharp = require('sharp');
  const buf = Buffer.alloc(w * h * 3).map(() => Math.floor(Math.random() * 256));
  const img = sharp(buf, { raw: { width: w, height: h, channels: 3 } });
  await (ext === '.png' ? img.png() : img.jpeg({ quality })).toFile(path);
}

function runCli(args: string[], env: NodeJS.ProcessEnv = {}): string {
  return execFileSync('npx', ['ts-node', SCRIPT, ...args], {
    cwd: BACKEND,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 180_000,
  });
}

describe('scripts/optimize-existing (batch-сжатие исторических фото)', () => {
  let root: string;
  let uploads: string;
  let backup: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'optimize-existing-'));
    uploads = join(root, 'uploads');
    backup = join(root, 'uploads_orig_backup');
    mkdirSync(join(uploads, 'picsum'), { recursive: true });
    mkdirSync(join(uploads, 'videos'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('не трогает видео', () => {
    const video = join(uploads, 'videos', 'clip.mp4');
    writeFileSync(video, Buffer.alloc(2 * 1024 * 1024, 7));
    const before = readFileSync(video);

    const out = runCli(['--dir', uploads], { OPTIMIZE_BACKUP_DIR: backup });

    expect(out).toContain('картинок: 0');
    expect(readFileSync(video).equals(before)).toBe(true);
    expect(existsSync(backup)).toBe(false);
  });

  (SHARP ? it : it.skip)('сжимает большое фото, кладёт оригинал в бэкап и не теряет его', async () => {
    const big = join(uploads, 'big.jpg');
    await makeNoise(big, 3024, 4032, '.jpg', 100);
    const beforeSize = statSync(big).size;

    const out = runCli(['--dir', uploads], { OPTIMIZE_BACKUP_DIR: backup });

    expect(out).toContain('Обработано (сжато):       1');
    const afterSize = statSync(big).size;
    expect(afterSize).toBeLessThan(beforeSize);

    // Оригинал сохранён нетронутым.
    const bak = join(backup, 'big.jpg');
    expect(existsSync(bak)).toBe(true);
    expect(statSync(bak).size).toBe(beforeSize);
  }, 180_000);

  (SHARP ? it : it.skip)('повторный прогон — no-op: качество не деградирует', async () => {
    const big = join(uploads, 'big.jpg');
    await makeNoise(big, 3024, 4032, '.jpg', 100);

    runCli(['--dir', uploads], { OPTIMIZE_BACKUP_DIR: backup });
    const afterFirst = statSync(big).size;
    const bytesFirst = readFileSync(big);

    const out2 = runCli(['--dir', uploads], { OPTIMIZE_BACKUP_DIR: backup });

    expect(out2).toContain('Обработано (сжато):       0');
    expect(out2).toContain('Пропущено (уже сжато):    1');
    // Файл БИТ-В-БИТ тот же — второй прогон его не тронул.
    expect(statSync(big).size).toBe(afterFirst);
    expect(readFileSync(big).equals(bytesFirst)).toBe(true);
    // И бэкап не перезаписан уже сжатой версией.
    expect(statSync(join(backup, 'big.jpg')).size).toBeGreaterThan(afterFirst);
  }, 300_000);

  (SHARP ? it : it.skip)('мелкие файлы (<=1600px и <=300 КБ) не трогает', async () => {
    const small = join(uploads, 'picsum', 'small_600x400.jpg');
    await makeNoise(small, 600, 400, '.jpg', 80);
    const before = readFileSync(small);

    const out = runCli(['--dir', uploads], { OPTIMIZE_BACKUP_DIR: backup });

    expect(out).toContain('Пропущено (уже мелкие):   1');
    expect(out).toContain('Обработано (сжато):       0');
    expect(readFileSync(small).equals(before)).toBe(true);
  }, 180_000);

  (SHARP ? it : it.skip)('--dry-run ничего не пишет и не создаёт бэкап', async () => {
    const big = join(uploads, 'big.jpg');
    await makeNoise(big, 3024, 4032, '.jpg', 100);
    const before = readFileSync(big);

    const out = runCli(['--dry-run', '--dir', uploads], { OPTIMIZE_BACKUP_DIR: backup });

    expect(out).toContain('DRY-RUN');
    expect(out).toContain('Обработано (сжато):       1');
    expect(readFileSync(big).equals(before)).toBe(true);
    expect(existsSync(join(backup, 'big.jpg'))).toBe(false);
    // Временных .opt-файлов не осталось.
    expect(existsSync(`${big}.opt.jpg`)).toBe(false);
  }, 180_000);

  (SHARP ? it : it.skip)('--force пересжимает уже обработанный файл', async () => {
    const big = join(uploads, 'big.jpg');
    await makeNoise(big, 3024, 4032, '.jpg', 100);

    runCli(['--dir', uploads], { OPTIMIZE_BACKUP_DIR: backup });
    const afterFirst = statSync(big).size;

    const out = runCli(['--force', '--dir', uploads], { OPTIMIZE_BACKUP_DIR: backup });

    expect(out).toContain('FORCE');
    expect(out).toContain('Пропущено (уже сжато):    0');
    expect(statSync(big).size).toBeLessThanOrEqual(afterFirst);
  }, 300_000);
});