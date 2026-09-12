import {
  IsString,
  IsNotEmpty,
  IsInt,
  Min,
  IsOptional,
  IsArray,
  MaxLength,
} from 'class-validator';

/**
 * FIX-REST фикс 6: у рекламы не было верхней границы ни на одном текстовом
 * поле (см. create-post.dto.ts — та же дыра, тот же фикс).
 */
export class CreateAdDto {
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

  @IsInt()
  @Min(1)
  days: number; // на сколько дней размещение
}