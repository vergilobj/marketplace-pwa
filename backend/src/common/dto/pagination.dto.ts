import { BadRequestException } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

/**
 * L1: единый потолок пагинации для ВСЕХ списочных эндпоинтов.
 *
 * P1: раньше потолка не было нигде, кроме `/users/me/ledger`. `GET /products
 * ?limit=100000` отдавал 2005 товаров / 1.16 МБ / 41 мс — любой мог одним
 * запросом выгрузить всю базу и положить процессор/сеть. Здесь и только здесь
 * живут константы и хелперы, чтобы потолок нельзя было «забыть» в одном месте.
 */
export const PAGINATION_MAX_LIMIT = 100;

/** Дефолт «страничных» списков. НЕ меняем — фронт ждёт 20. */
export const PAGINATION_DEFAULT_LIMIT = 20;

/**
 * Дефолт для списков, которые фронт читает целиком (без infinite scroll):
 * «мои товары», комментарии поста, рефералы, выводы, инвайты, сделки. Здесь
 * дефолт 20 обрезал бы данные в UI, поэтому — большой, но всё же конечный.
 */
export const PAGINATION_BULK_LIMIT = 100;

/** Отдельный, более щедрый потолок для треда сделки (арбитраж читает переписку). */
export const DEAL_THREAD_MAX_LIMIT = 500;
export const DEAL_THREAD_DEFAULT_LIMIT = 200;

/**
 * DTO пагинации для `@Query()`. Валидация даёт 400 на нечисловой/отрицательный
 * limit, а сервисный `clampLimit` добивает верхнюю границу (>100 → 100).
 *
 * Верхней границы (@Max) здесь НАМЕРЕННО нет: фронт (`FavoritesPage`) зовёт
 * `getProducts({ limit: 2000 })`, и 400 на limit>100 сломал бы страницу.
 * Вместо отказа — кламп до PAGINATION_MAX_LIMIT.
 */
export class PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be >= 1' })
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be >= 1' })
  limit?: number = PAGINATION_DEFAULT_LIMIT;
}

/**
 * Контроллерный парсер limit: 400 на мусор, кламп на «слишком много».
 *
 * `abc`  → Number('abc') = NaN → не integer → 400
 * `-5`   → < 1 → 400
 * `100000` → integer, клампится до 100
 * отсутствует/пусто → дефолт (обратная совместимость)
 */
export function parseLimit(
  raw: unknown,
  def: number = PAGINATION_DEFAULT_LIMIT,
  max: number = PAGINATION_MAX_LIMIT,
): number {
  if (raw === undefined || raw === null || raw === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new BadRequestException('limit must be an integer >= 1');
  }
  return Math.min(n, max);
}

/** Контроллерный парсер page: 400 на мусор/ноль, без верхней границы. */
export function parsePage(raw: unknown, def = 1): number {
  if (raw === undefined || raw === null || raw === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new BadRequestException('page must be an integer >= 1');
  }
  return n;
}

/**
 * Сервисный кламп — вторая линия защиты (инвариант безопасности).
 *
 * Работает даже если контроллер забыл провалидировать параметр (или новый
 * эндпоинт добавят без DTO). Никогда не бросает: мусор → дефолт, >max → max.
 */
export function clampLimit(
  raw: unknown,
  def: number = PAGINATION_DEFAULT_LIMIT,
  max: number = PAGINATION_MAX_LIMIT,
): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  const i = Math.trunc(n);
  if (i < 1) return def;
  return Math.min(i, max);
}

/** Сервисный кламп страницы: мусор/ноль → 1. */
export function clampPage(raw: unknown, def = 1): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  const i = Math.trunc(n);
  return i < 1 ? def : i;
}
