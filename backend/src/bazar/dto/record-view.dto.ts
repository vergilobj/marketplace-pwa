import { IsNotEmpty, IsString } from 'class-validator';

/**
 * GAPS-A: POST /bazar/views.
 *
 * Было `@Body() body: { productId: string }` — пустой/нестроковый productId
 * доходил до `prisma.viewEvent.create` → 500 (FK/тип). Фронт шлёт `{ productId }`.
 */
export class RecordViewDto {
  @IsString()
  @IsNotEmpty({ message: 'productId обязателен' })
  productId: string;
}