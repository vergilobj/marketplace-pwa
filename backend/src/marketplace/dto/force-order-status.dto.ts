import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { OrderStatus } from '@prisma/client';

/**
 * PATCH /orders/:id/force-status — ручной обход матрицы переходов (§3).
 * reason обязателен: любое вмешательство админа должно быть объяснено
 * и попадает в AuditLog.
 */
export class ForceOrderStatusDto {
  @IsEnum(OrderStatus)
  @IsNotEmpty()
  status: OrderStatus;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}