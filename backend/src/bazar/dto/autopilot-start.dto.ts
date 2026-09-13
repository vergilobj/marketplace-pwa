import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
} from 'class-validator';

/**
 * GAPS-A: POST /bazar/autopilot/start.
 *
 * Было `@Body() body: { goal: string; budget?: number }`. Пустая цель давала
 * пустой поиск, а мусорный budget («abc») — NaN в `AutopilotRun.budget`.
 */
export class AutopilotStartDto {
  @IsString()
  @IsNotEmpty({ message: 'goal обязателен' })
  @MaxLength(500)
  goal: string;

  @IsOptional()
  @IsNumber({}, { message: 'budget должен быть числом' })
  @IsPositive({ message: 'budget должен быть > 0' })
  @Max(1_000_000_000, { message: 'budget слишком велик' })
  budget?: number;
}