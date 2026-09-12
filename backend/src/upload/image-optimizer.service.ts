import { Injectable, Logger } from '@nestjs/common';
import { statSync, renameSync, unlinkSync } from 'fs';
import { extname } from 'path';

/**
 * FIX-REST фикс 3: КОРЕНЬ «битых/серых картинок» в ленте.
 *
 * ЧТО БЫЛО НЕ ТАК. `multer` клал файл на диск КАК ЕСТЬ, без единой
 * трансформации. Проверено живьём на проде: в боевых товарах лежат JPEG
 * 3.88 МБ, 3.77 МБ и 2.13 МБ. 211 медиа первых трёх страниц ленты весят
 * 17.4 МБ, из которых эти ТРИ файла — 9.8 МБ, то есть 56% всего трафика.
 * На мобильной сети 3.88 МБ качается ~20 секунд, и всё это время на месте
 * картинки серый прямоугольник — ровно то, что владелец называет «битыми
 * картинками».
 *
 * ПОЧЕМУ НЕ `loading="lazy"`. Атрибут работает корректно: замер на проде
 * (Fast 3G + 4x CPU throttle) дал 0 битых картинок в поле зрения на каждом
 * шаге скролла. Проблема не в том, КОГДА картинка начинает грузиться, а в
 * том, СКОЛЬКО она весит. Поэтому чиним вес, а не атрибут.
 *
 * ЧТО ДЕЛАЕМ. После сохранения файла: если сторона > MAX_DIMENSION — уменьшаем
 * до неё, затем пережимаем в исходном формате. Оригинал не удаляем, пока не
 * убедились, что пережатый файл валиден и меньше исходного (иначе оставляем
 * как было — лучше тяжёлая картинка, чем битая).
 *
 * ГАРАНТИИ: НИКОГДА не бросает исключение — сбой оптимизации не должен ломать
 * загрузку пользователя (тот же принцип, что в UploadsReplicationService).
 * Работает best-effort: не вышло — файл остаётся нетронутым.
 */
@Injectable()
export class ImageOptimizerService {
  private readonly logger = new Logger(ImageOptimizerService.name);

  /** Максимальная сторона. 1600px хватает для 2x-retina на телефоне. */
  private readonly maxDimension = 1600;

  /** Качество пережатия. 82 — визуально неотличимо, вес падает в разы. */
  private readonly quality = 82;

  /** Ниже этого порога не трогаем — уже нормально. */
  private readonly skipBelowBytes = 300 * 1024;

  /** Форматы, которые sharp умеет пережимать без потери совместимости. */
  private readonly optimizable = new Set(['.jpg', '.jpeg', '.png', '.webp']);

  /**
   * PERF-3: про отсутствие sharp ругаемся ровно один раз за жизнь процесса.
   * Без этого «sharp не встал на ноде» выглядит как обычный warn на каждой
   * загрузке — то есть деградация (все фото уходят в прод несжатыми) тонет в
   * логах. Поведение не меняется: файл так же остаётся как есть.
   */
  private sharpUnavailableLogged = false;

  /**
   * Сжимает картинку на месте. Возвращает статистику для лога/тестов.
   * Никогда не бросает — при любой ошибке возвращает { skipped }.
   */
  async optimize(absPath: string): Promise<{
    skipped: boolean;
    before: number;
    after: number;
    reason?: string;
  }> {
    let before = 0;
    try {
      const ext = extname(absPath).toLowerCase();
      if (!this.optimizable.has(ext)) {
        return { skipped: true, before: 0, after: 0, reason: 'unsupported-ext' };
      }

      before = statSync(absPath).size;
      if (before < this.skipBelowBytes) {
        return { skipped: true, before, after: before, reason: 'already-small' };
      }

      // Ленивый require: sharp — нативный модуль, и если его бинарник не
      // встал на этой ноде, упасть должен ТОЛЬКО этот вызов, а не старт
      // всего приложения.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      let sharp: typeof import('sharp');
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        sharp = require('sharp');
      } catch (sharpErr) {
        // PERF-3: раньше это тонуло в общем catch с текстом «optimize failed».
        // Теперь явно и однократно: это НЕ «плохая картинка», это сломанная
        // нода — все загрузки идут в прод несжатыми, нужен ремонт окружения.
        if (!this.sharpUnavailableLogged) {
          this.sharpUnavailableLogged = true;
          this.logger.error(
            `sharp недоступен — оптимизация картинок ОТКЛЮЧЕНА на этой ноде, ` +
              `фото сохраняются как есть (проверь node_modules/sharp): ${(sharpErr as Error).message}`,
          );
        }
        return { skipped: true, before, after: before, reason: 'sharp-unavailable' };
      }

      const meta = await sharp(absPath).metadata();

      // PERF-3 (найденный баг): EXIF-ориентация 5–8 означает, что при рендере
      // картинка поворачивается на 90°, то есть «ширина» и «высота» меняются
      // местами. `rotate()` в пайплайне выполняется ДО resize, поэтому решать,
      // какая сторона длинная, нужно по РАЗМЕРАМ ПОСЛЕ поворота — иначе resize
      // выбирал не ту сторону, и длинная сторона оставалась больше 1600.
      // Живой пример с прода: `146160b5-...jpeg` (4032x3024, orientation=6)
      // давал на выходе 1600x2133 вместо 1200x1600.
      const swapSides =
        typeof meta.orientation === 'number' && meta.orientation >= 5;
      const rawW = meta.width || 0;
      const rawH = meta.height || 0;
      const effW = swapSides ? rawH : rawW;
      const effH = swapSides ? rawW : rawH;
      const longEdge = Math.max(effW, effH);
      const needsResize = longEdge > this.maxDimension;

      let pipeline = sharp(absPath).rotate(); // rotate() без аргумента = по EXIF
      if (needsResize) {
        pipeline = pipeline.resize({
          width: effW >= effH ? this.maxDimension : undefined,
          height: effH > effW ? this.maxDimension : undefined,
          fit: 'inside',
          withoutEnlargement: true,
        });
      }

      // Пережимаем в исходном формате: менять расширение нельзя — на него
      // завязаны Content-Type в nginx и уже сохранённые в БД URL.
      if (ext === '.png') {
        pipeline = pipeline.png({ compressionLevel: 9, palette: true });
      } else if (ext === '.webp') {
        pipeline = pipeline.webp({ quality: this.quality });
      } else {
        pipeline = pipeline.jpeg({ quality: this.quality, mozjpeg: true });
      }

      const tmp = `${absPath}.opt${ext}`;
      await pipeline.toFile(tmp);

      const after = statSync(tmp).size;
      // Страховка: если «оптимизация» сделала файл больше или почти не
      // изменила — оставляем оригинал и убираем временный.
      if (after >= before * 0.95) {
        unlinkSync(tmp);
        return { skipped: true, before, after: before, reason: 'no-gain' };
      }

      // Проверяем, что результат реально читается, и только потом подменяем.
      const check = await sharp(tmp).metadata();
      if (!check.width || !check.height) {
        unlinkSync(tmp);
        return { skipped: true, before, after: before, reason: 'invalid-output' };
      }

      renameSync(tmp, absPath);
      this.logger.log(
        `optimize ${absPath}: ${(before / 1024).toFixed(0)}KB → ${(after / 1024).toFixed(0)}KB ` +
          `(${(100 - (after / before) * 100).toFixed(0)}% меньше)`,
      );
      return { skipped: false, before, after };
    } catch (e) {
      this.logger.warn(
        `optimize failed for ${absPath}: ${(e as Error).message} — файл оставлен как есть`,
      );
      return { skipped: true, before, after: before, reason: 'error' };
    }
  }
}