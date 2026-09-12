#!/usr/bin/env -S npx ts-node
/**
 * PERF-3: одноразовое сжатие ИСТОРИЧЕСКИХ фото в uploads/.
 *
 * ЗАЧЕМ. `ImageOptimizerService` (src/upload/image-optimizer.service.ts) сжимает
 * картинку сразу после загрузки, но файлы, залитые ДО его появления, так и лежат
 * оригиналами. Замер на проде: `uploads/62128887-...jpeg` = 3.88 МБ, 3024x4032,
 * а отдаётся он в CSS-слот 56x56. Такие файлы надо пережать разово.
 *
 * ЧТО ДЕЛАЕТ. Идёт по uploads/ и для КАЖДОГО файла .jpg/.jpeg/.png/.webp
 * применяет РОВНО ту же логику, что и сервис:
 *     maxDimension = 1600, quality = 82, mozjpeg, rotate() по EXIF,
 *     fit: 'inside', withoutEnlargement: true
 * (настройки намеренно продублированы, а не импортированы: сервис — Nest-
 *  провайдер с логгером, тянуть его в CLI-скрипт неудобно; если менять — то в
 *  обоих местах. Тест `optimize-existing.spec.ts` сверяет константы.)
 *
 * УСЛОВИЕ ОБРАБОТКИ: длинная сторона > 1600px ИЛИ размер > 300 КБ.
 *   Мелкие файлы (< 300 КБ и <= 1600px) НЕ трогаем — пересжатие ради
 *   пересжатия только теряет качество (это 2008 picsum-превью по ~35 КБ).
 *
 * ГАРАНТИИ БЕЗОПАСНОСТИ:
 *   - Оригинал ПЕРЕД перезаписью копируется в uploads_orig_backup/<relpath>.
 *   - Перезапись только если новый файл (а) читается sharp и (б) реально
 *     меньше исходного хотя бы на 5%. Иначе — оригинал остаётся, temp удаляется.
 *   - .mp4/.webm/.mov/.mkv и любые прочие расширения НЕ открываются вообще.
 *   - Ошибка на одном файле не останавливает проход (best-effort, как в сервисе).
 *
 * ИДЕМПОТЕНТНОСТЬ (важно!). Условие «размер > 300 КБ» само по себе НЕ делает
 * прогон безопасным для повтора: шумное фото 800x800, которое после сжатия
 * остаётся 315 КБ, на следующем запуске снова попадёт под условие и потеряет
 * ещё 5% качества — и так на каждом прогоне. Поэтому скрипт ведёт журнал
 * `<backup>/.optimize-state.json` (путь + mtime + размер) и во второй раз такие
 * файлы пропускает. Для принудительного пересжатия — `--force`.
 *
 * ЗАПУСК (на сервере, из каталога backend):
 *   npx ts-node scripts/optimize-existing.ts              # боевой прогон
 *   npx ts-node scripts/optimize-existing.ts --dry-run    # только показать
 *   npx ts-node scripts/optimize-existing.ts --dir /path  # другой каталог
 *   npx ts-node scripts/optimize-existing.ts --force      # игнорировать журнал
 */
import {
  readdirSync,
  statSync,
  mkdirSync,
  existsSync,
  copyFileSync,
  renameSync,
  unlinkSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { join, extname, relative, dirname } from 'path';

// ── Те же константы, что в ImageOptimizerService ────────────────────────────
const MAX_DIMENSION = 1600;
const QUALITY = 82;
const SKIP_BELOW_BYTES = 300 * 1024;
const OPTIMIZABLE = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FORCE = args.includes('--force');
const dirArg = args.indexOf('--dir');
const ROOT = dirArg >= 0 && args[dirArg + 1] ? args[dirArg + 1] : join(process.cwd(), 'uploads');
const BACKUP_ROOT = process.env.OPTIMIZE_BACKUP_DIR || join(dirname(ROOT), 'uploads_orig_backup');
const STATE_FILE = join(BACKUP_ROOT, '.optimize-state.json');

/**
 * PERF-3: временные файлы пишем ВНЕ каталога uploads.
 *
 * Здесь была реальная авария на проде. Изначально temp создавался рядом с
 * оригиналом (`<file>.opt.jpeg`, как в ImageOptimizerService). Но uploads/
 * непрерывно сканирует демон `uploads-sync.sh` (каждые 60 с), и он успел
 * утащить этот промежуточный файл на вторую ноду — на обеих нодах остался
 * мусорный `62128887-....jpeg.opt.jpeg` нулевого размера. Каталог тот же
 * (переименование не упирается в границу ФС), но синк его не видит.
 */
const TMP_DIR = process.env.OPTIMIZE_TMP_DIR || join(dirname(ROOT), '.optimize-tmp');

/** Журнал «уже сжато»: relpath -> "<mtimeMs>:<size>". Защищает от повторного пересжатия. */
type State = Record<string, string>;
const stateKey = (abs: string) => {
  const st = statSync(abs);
  return `${st.mtimeMs}:${st.size}`;
};
function loadState(): State {
  try {
    if (!existsSync(STATE_FILE)) return {};
    const parsed = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as State) : {};
  } catch {
    // Битый журнал — не повод падать: считаем, что журнала нет.
    return {};
  }
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

/**
 * PERF-3: собственные временные файлы (`foo.jpeg.opt.jpeg`) не должны попадать
 * в обход. Скрипт пишет их рядом с оригиналом, и если такой файл уцелел от
 * прерванного прогона, он подхватывался как обычная картинка: получался ложный
 * «файл-призрак» в статистике и ошибка ENOENT, когда оригинал его уже переименовал.
 */
const isTempArtifact = (p: string) => /\.opt(\.[a-z0-9]+)?$/i.test(p);

const kb = (b: number) => (b / 1024).toFixed(0);
const mb = (b: number) => (b / 1024 / 1024).toFixed(2);

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const sharp = require('sharp');

  if (!existsSync(ROOT)) {
    console.error(`Каталог не найден: ${ROOT}`);
    process.exit(1);
  }

  const all = walk(ROOT);
  const images = all.filter(
    (f) => OPTIMIZABLE.has(extname(f).toLowerCase()) && !isTempArtifact(f),
  );
  const state = FORCE ? {} : loadState();
  const newState: State = { ...state };

  console.log(`Каталог:  ${ROOT}`);
  console.log(`Бэкап:    ${BACKUP_ROOT}`);
  console.log(`Журнал:   ${STATE_FILE} (${Object.keys(state).length} записей)`);
  console.log(`Режим:    ${DRY_RUN ? 'DRY-RUN (ничего не пишем)' : 'БОЕВОЙ'}${FORCE ? ' + FORCE (журнал игнорируется)' : ''}`);
  console.log(`Всего файлов: ${all.length}, из них картинок: ${images.length}`);
  console.log('─'.repeat(72));

  let processed = 0;
  let skippedSmall = 0;
  let skippedNoGain = 0;
  let skippedDone = 0;
  let failed = 0;
  let totalBefore = 0;
  let totalAfter = 0;
  const savedRows: Array<{ rel: string; before: number; after: number; w: number; h: number; nw: number; nh: number }> = [];

  for (const abs of images) {
    const rel = relative(ROOT, abs);
    let before = 0;
    try {
      before = statSync(abs).size;
      const ext = extname(abs).toLowerCase();

      // Уже обрабатывали этот самый файл (тот же mtime и размер) — не трогаем.
      // Без этой проверки файл, оставшийся > 300 КБ после сжатия, терял бы
      // по ~5% качества на КАЖДОМ повторном прогоне.
      if (!FORCE && state[rel] && state[rel] === stateKey(abs)) {
        skippedDone++;
        continue;
      }

      const meta = await sharp(abs).metadata();
      const w = meta.width || 0;
      const h = meta.height || 0;

      // PERF-3: EXIF-ориентация 5–8 = поворот на 90° при рендере, то есть
      // стороны меняются местами. `rotate()` идёт ДО resize, поэтому сторону
      // для resize надо выбирать по размерам ПОСЛЕ поворота. Иначе, например,
      // 4032x3024 с orientation=6 (портрет на телефоне) выходил 1600x2133 —
      // длинная сторона так и оставалась больше лимита. Тот же фикс в
      // src/upload/image-optimizer.service.ts, константы обязаны совпадать.
      const swapSides = typeof meta.orientation === 'number' && meta.orientation >= 5;
      const effW = swapSides ? h : w;
      const effH = swapSides ? w : h;
      const longEdge = Math.max(effW, effH);

      // Условие обработки: большое по стороне ИЛИ тяжёлое по весу.
      if (longEdge <= MAX_DIMENSION && before <= SKIP_BELOW_BYTES) {
        skippedSmall++;
        continue;
      }

      let pipeline = sharp(abs).rotate();
      if (longEdge > MAX_DIMENSION) {
        pipeline = pipeline.resize({
          width: effW >= effH ? MAX_DIMENSION : undefined,
          height: effH > effW ? MAX_DIMENSION : undefined,
          fit: 'inside',
          withoutEnlargement: true,
        });
      }
      if (ext === '.png') pipeline = pipeline.png({ compressionLevel: 9, palette: true });
      else if (ext === '.webp') pipeline = pipeline.webp({ quality: QUALITY });
      else pipeline = pipeline.jpeg({ quality: QUALITY, mozjpeg: true });

      // Temp — в отдельном каталоге рядом (НЕ внутри uploads): иначе его
      // подхватит демон репликации, как это уже случилось на проде.
      mkdirSync(TMP_DIR, { recursive: true });
      const tmp = join(TMP_DIR, `${rel.replace(/[\\/]/g, '__')}.opt${ext}`);
      await pipeline.toFile(tmp);

      const after = statSync(tmp).size;
      if (after >= before * 0.95) {
        unlinkSync(tmp);
        skippedNoGain++;
        // Помечаем как «рассмотрен» — иначе шумные фото, которые не сжимаются,
        // будут пересматриваться (и гонять sharp) на каждом прогоне.
        newState[rel] = stateKey(abs);
        console.log(`  ~ ${rel}: ${kb(before)}KB → ${kb(after)}KB — выигрыша нет, оригинал оставлен`);
        continue;
      }

      const check = await sharp(tmp).metadata();
      if (!check.width || !check.height) {
        unlinkSync(tmp);
        failed++;
        console.log(`  ! ${rel}: результат не читается — оригинал оставлен`);
        continue;
      }

      console.log(
        `  + ${rel}: ${kb(before)}KB → ${kb(after)}KB (${(100 - (after / before) * 100).toFixed(0)}% меньше) ` +
          `${w}x${h} → ${check.width}x${check.height}`,
      );

      if (DRY_RUN) {
        unlinkSync(tmp);
      } else {
        // Бэкап оригинала ПЕРЕЗАПИСЬЮ: кладём ТОЛЬКО если его там ещё нет —
        // иначе повторный запуск затрёт настоящий оригинал уже сжатой версией.
        const bak = join(BACKUP_ROOT, rel);
        mkdirSync(dirname(bak), { recursive: true });
        if (!existsSync(bak)) copyFileSync(abs, bak);
        renameSync(tmp, abs);
        // Фиксируем в журнале НОВОЕ состояние файла (после подмены).
        newState[rel] = stateKey(abs);
      }

      processed++;
      totalBefore += before;
      totalAfter += after;
      savedRows.push({ rel, before, after, w, h, nw: check.width, nh: check.height });
    } catch (e) {
      failed++;
      console.log(`  ! ${rel}: ${(e as Error).message} — файл оставлен как есть`);
    }
  }

  // Журнал пишем всегда (кроме dry-run): он же фиксирует и «нет выигрыша»,
  // чтобы такие файлы не пересматривались каждый прогон. Пустой журнал не
  // создаём — прогон по папке без картинок не должен оставлять после себя
  // каталог бэкапов.
  if (!DRY_RUN && Object.keys(newState).length > 0) {
    try {
      mkdirSync(BACKUP_ROOT, { recursive: true });
      writeFileSync(STATE_FILE, JSON.stringify(newState, null, 1));
    } catch (e) {
      console.log(`  ! не удалось записать журнал ${STATE_FILE}: ${(e as Error).message}`);
    }
  }

  // Подчищаем каталог временных файлов (в нём не должно оставаться мусора —
  // ни от этого прогона, ни от прерванного предыдущего).
  try {
    if (existsSync(TMP_DIR)) {
      for (const f of readdirSync(TMP_DIR)) {
        try {
          unlinkSync(join(TMP_DIR, f));
        } catch {
          /* гонка — не критично */
        }
      }
      try {
        rmdirSync(TMP_DIR);
      } catch {
        /* непустой — оставляем */
      }
    }
  } catch {
    /* не смогли прибрать — не повод падать */
  }

  console.log('─'.repeat(72));
  console.log(`Обработано (сжато):       ${processed}`);
  console.log(`Пропущено (уже сжато):    ${skippedDone}`);
  console.log(`Пропущено (уже мелкие):   ${skippedSmall}`);
  console.log(`Пропущено (нет выигрыша): ${skippedNoGain}`);
  console.log(`Ошибок:                   ${failed}`);
  if (processed > 0) {
    console.log(
      `Экономия: ${mb(totalBefore)} МБ → ${mb(totalAfter)} МБ ` +
        `(минус ${mb(totalBefore - totalAfter)} МБ, ${(100 - (totalAfter / totalBefore) * 100).toFixed(0)}%)`,
    );
    console.log('Крупнейшие:');
    for (const r of savedRows.sort((a, b) => b.before - a.before).slice(0, 10)) {
      console.log(`  ${r.rel}: ${kb(r.before)}KB → ${kb(r.after)}KB, ${r.w}x${r.h} → ${r.nw}x${r.nh}`);
    }
  }
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});