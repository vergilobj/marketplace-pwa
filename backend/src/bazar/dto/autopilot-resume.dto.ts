import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * GAPS-A: POST /bazar/autopilot/resume.
 *
 * Было инлайн-тело `{ type: 'confirm'|'refine'; accept?; productId?; feedback? }`
 * без валидации: `type: 'garbage'` уходил в ветку refine, а не отбивался 400.
 */
export class AutopilotResumeDto {
  @IsIn(['confirm', 'refine'], {
    message: "type должен быть 'confirm' или 'refine'",
  })
  type: 'confirm' | 'refine';

  @IsOptional()
  @IsBoolean()
  accept?: boolean;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  productId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  feedback?: string;
}