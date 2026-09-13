import { IsNumber, IsPositive, Max } from 'class-validator';

/**
 * GAPS-A: POST /bazar/deals/:id/counter (контр-оффер).
 *
 * Было `@Body() body: { amount: number }` → мусор («abc», null, {}) доходил
 * до сервиса, где уже делался `Number(body.amount)` = NaN → Prisma/логика
 * падали в 500. Теперь сумма обязательна, положительна и конечна.
 */
export class DealCounterDto {
  @IsNumber({}, { message: 'amount должен быть числом' })
  @IsPositive({ message: 'amount должен быть > 0' })
  @Max(1_000_000_000, { message: 'amount слишком велик' })
  amount: number;
}