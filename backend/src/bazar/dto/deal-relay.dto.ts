import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * GAPS-A: POST /bazar/deals/:id/relay.
 *
 * Было `@Body() body: { text: string }` — инлайн-тип не валидируется
 * ValidationPipe'ом, мусор доходил до Prisma (500 вместо 400). Фронт шлёт
 * ровно `{ text }` (frontend/src/api/bazar.ts:bazarDealRelay).
 */
export class DealRelayDto {
  @IsString()
  @IsNotEmpty({ message: 'text обязателен' })
  @MaxLength(4000)
  text: string;
}