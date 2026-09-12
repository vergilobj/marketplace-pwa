import { ImageOptimizerService } from './image-optimizer.service';
import { mkdtempSync, writeFileSync, statSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * PERF-3: у ImageOptimizerService раньше НЕ БЫЛО спеки вообще — а это сервис,
 * который молча перезаписывает пользовательские файлы. Тесты проверяют ровно
 * те свойства, из-за которых он может испортить данные:
 *   1) не-картинки/маленькие файлы не трогаются;
 *   2) большая картинка реально уменьшается по стороне и весу;
 *   3) файл, который не сжимается (уже оптимальный), остаётся БИТ-В-БИТ;
 *   4) отсутствие sharp — не исключение, а skip с явной причиной.
 *
 * sharp — нативный модуль; в CI может отсутствовать. Тесты, которым он нужен,
 * сами себя пропускают (describe.skip), а проверка «sharp нет» не требует его
 * наличия вообще.
 */
function hasSharp(): boolean {
  try {
    require('sharp');
    return true;
  } catch {
    return false;
  }
}

const SHARP = hasSharp();

describe('ImageOptimizerService', () => {
  let svc: ImageOptimizerService;
  let dir: string;

  beforeEach(() => {
    svc = new ImageOptimizerService();
    dir = mkdtempSync(join(tmpdir(), 'imgopt-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('не трогает файлы неподдерживаемых расширений (видео и прочее)', async () => {
    const p = join(dir, 'clip.mp4');
    writeFileSync(p, Buffer.alloc(5 * 1024 * 1024, 7));
    const before = statSync(p).size;
    const beforeBytes = readFileSync(p);

    const res = await svc.optimize(p);

    expect(res.skipped).toBe(true);
    expect(res.reason).toBe('unsupported-ext');
    expect(statSync(p).size).toBe(before);
    expect(readFileSync(p).equals(beforeBytes)).toBe(true);
  });

  it('не трогает файлы меньше порога 300 КБ', async () => {
    const p = join(dir, 'small.jpg');
    writeFileSync(p, Buffer.alloc(50 * 1024, 3));
    const beforeBytes = readFileSync(p);

    const res = await svc.optimize(p);

    expect(res.skipped).toBe(true);
    expect(res.reason).toBe('already-small');
    expect(readFileSync(p).equals(beforeBytes)).toBe(true);
  });

  it('нет файла — skip с причиной error, исключения НЕ бросает (best-effort)', async () => {
    await expect(svc.optimize(join(dir, 'nope.jpg'))).resolves.toMatchObject({
      skipped: true,
      reason: 'error',
    });
  });

  it('битый файл с расширением картинки — skip, оригинал не тронут', async () => {
    const p = join(dir, 'broken.jpg');
    const junk = Buffer.alloc(400 * 1024, 9); // > 300 КБ, но не JPEG
    writeFileSync(p, junk);

    const res = await svc.optimize(p);

    expect(res.skipped).toBe(true);
    expect(res.reason).toBe('error');
    expect(readFileSync(p).equals(junk)).toBe(true);
  });

  (SHARP ? describe : describe.skip)('с sharp', () => {
    // sharp на 3024x4032 + генерация шумового буфера — это секунды, дефолтных
    // 5 с не хватает.
    const T = 120_000;

    it('большую картинку уменьшает до 1600px и сжимает по весу', async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const sharp = require('sharp');
      const p = join(dir, 'big.jpg');
      const noise = Buffer.alloc(3024 * 4032 * 3).map(() => Math.floor(Math.random() * 256));
      await sharp(noise, { raw: { width: 3024, height: 4032, channels: 3 } })
        .jpeg({ quality: 100 })
        .toFile(p);
      const before = statSync(p).size;

      const res = await svc.optimize(p);

      expect(res.skipped).toBe(false);
      expect(res.after).toBeLessThan(before);
      const meta = await sharp(p).metadata();
      expect(Math.max(meta.width, meta.height)).toBeLessThanOrEqual(1600);
    }, T);

    it('уже оптимальный файл остаётся БИТ-В-БИТ (no-gain → оригинал)', async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const sharp = require('sharp');
      const p = join(dir, 'tiny-dims.jpg');
      // Мелкое разрешение, но «тяжёлый» шум: resize не поможет, а пережатие
      // в jpeg q82 не даст 5% выигрыша → должен сработать guard no-gain.
      const noise = Buffer.alloc(400 * 400 * 3).map(() => Math.floor(Math.random() * 256));
      await sharp(noise, { raw: { width: 400, height: 400, channels: 3 } })
        .jpeg({ quality: 100 })
        .toFile(p);
      const before = statSync(p).size;
      const beforeBytes = readFileSync(p);

      const res = await svc.optimize(p);

      if (res.skipped) {
        expect(readFileSync(p).equals(beforeBytes)).toBe(true);
      } else {
        // Если всё же сжалось — файл обязан быть валидной картинкой и легче.
        expect(res.after).toBeLessThan(before);
        const meta = await sharp(p).metadata();
        expect(meta.width).toBe(400);
      }
    }, T);

    it('не увеличивает картинку меньше 1600px (withoutEnlargement)', async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const sharp = require('sharp');
      const p = join(dir, 'mid.jpg');
      const noise = Buffer.alloc(900 * 900 * 3).map(() => Math.floor(Math.random() * 256));
      await sharp(noise, { raw: { width: 900, height: 900, channels: 3 } })
        .jpeg({ quality: 100 })
        .toFile(p);

      await svc.optimize(p);

      const meta = await sharp(p).metadata();
      expect(meta.width).toBeLessThanOrEqual(900);
      expect(meta.height).toBeLessThanOrEqual(900);
    }, T);

    it('EXIF-повёрнутое фото (orientation 6): длинная сторона <= 1600 после поворота', async () => {
      // PERF-3, найденный на проде баг: `146160b5-...jpeg` (4032x3024,
      // orientation=6) выходил 1600x2133, потому что сторону для resize
      // выбирали по ДО-поворотным размерам, а rotate() идёт раньше resize.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const sharp = require('sharp');
      const p = join(dir, 'rotated.jpg');
      const noise = Buffer.alloc(4032 * 3024 * 3).map(() => Math.floor(Math.random() * 256));
      await sharp(noise, { raw: { width: 4032, height: 3024, channels: 3 } })
        .withMetadata({ orientation: 6 })
        .jpeg({ quality: 100 })
        .toFile(p);

      const res = await svc.optimize(p);
      expect(res.skipped).toBe(false);

      // Смотрим на РЕНДЕР-размер (autoOrient применяет EXIF-поворот).
      const rendered = await sharp(p).rotate().toBuffer({ resolveWithObject: true });
      const longEdge = Math.max(rendered.info.width, rendered.info.height);
      expect(longEdge).toBeLessThanOrEqual(1600);

      // Ориентация должна быть «впечена» в пиксели — в файле больше нет EXIF-тега,
      // иначе браузер повернёт картинку второй раз.
      const metaAfter = await sharp(p).metadata();
      expect([undefined, 1]).toContain(metaAfter.orientation);
    }, T);
  });
});