import { IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * GAPS-A: POST /users/me/withdrawal.
 *
 * Было `@Body('amount') amount: number` + `@Body('toAddress') toAddress?` —
 * сырое значение уходило в сервис. `{"amount":"abc"}` проходил (NaN ловился
 * позже), но `toAddress: 123` доходил до `toAddress.trim()` → TypeError → 500.
 * Фронт (WithdrawalsPage) шлёт `{ amount: number, toAddress: '0x…' }`.
 */
export class RequestWithdrawalDto {
  @Type(() => Number)
  @IsNumber({}, { message: 'amount должен быть числом' })
  @IsNotEmpty({ message: 'amount обязателен' })
  amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  toAddress?: string;
}