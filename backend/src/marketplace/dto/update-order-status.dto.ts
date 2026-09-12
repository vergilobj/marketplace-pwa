import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsIn,
} from 'class-validator';
import { OrderStatus } from '@prisma/client';

export class UpdateOrderStatusDto {
  @IsEnum(OrderStatus)
  @IsNotEmpty()
  status: OrderStatus;

  /**
   * NH8: решение покупателя при открытии спора.
   * `refund` — покупатель требует возврат (пишется в Order.cancelReason как
   * USER_DECISION и учитывается арбитражем); `keep`/отсутствие — без пометки.
   * Опционально, чтобы не ломать существующих клиентов (forbidNonWhitelisted).
   */
  @IsOptional()
  @IsIn(['refund', 'keep'])
  decision?: 'refund' | 'keep';

  /** NH8: комментарий покупателя для арбитра. */
  @IsOptional()
  @IsString()
  buyerNote?: string;
}
