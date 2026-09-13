import { IsNotEmpty, IsString } from 'class-validator';

/**
 * GAPS-A: path/query-параметры, которые уходили в Prisma «как есть».
 *
 * Невалидный id (не строка) не бросает в Prisma, но мусорные значения
 * (`""`, объекты из query) доходят до запроса и дают невнятные ответы.
 * DTO на `@Param`/`@Query` отсекает это ValidationPipe'ом → 400.
 */
export class IdParamDto {
  @IsString()
  @IsNotEmpty()
  id: string;
}