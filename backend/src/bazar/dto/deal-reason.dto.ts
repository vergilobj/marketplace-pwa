import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * GAPS-A: POST /bazar/deals/:id/cancel и /dispute.
 *
 * Было `@Body() body?: { reason?: string }` — необязательное тело без
 * валидации. Причина необязательна (фронт может не присылать тело), но если
 * пришла — это строка ограниченной длины.
 */
export class DealReasonDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}