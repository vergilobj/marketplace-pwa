import { IsString, IsNotEmpty, IsOptional, IsArray, MaxLength } from 'class-validator';

/**
 * FIX-REST фикс 6: у полей не было верхней границы вообще.
 *
 * Проверено живьём на проде: в боевой таблице лежит товар с title в 10 000
 * символов (создан 2026-08-01, ДО того как у товаров появился @MaxLength).
 * У постов и рекламы границы не было ни тогда, ни сейчас — то есть пост с
 * заголовком на мегабайт создавался успешно.
 *
 * Границы выбраны по фактическому контенту: title товара уже 200, поэтому
 * здесь то же значение для единообразия; content — 5000 (посты длиннее
 * выглядят как спам и раздувают выдачу ленты); link — 500.
 *
 * Побочный эффект: `forbidNonWhitelisted: true` в main.ts не ловит эти поля,
 * поэтому ограничение обязано жить именно в DTO.
 */
export class CreatePostDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200, { message: 'Заголовок не длиннее 200 символов' })
  title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000, { message: 'Текст не длиннее 5000 символов' })
  content: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  link?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  media?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  videoUrl?: string;
}