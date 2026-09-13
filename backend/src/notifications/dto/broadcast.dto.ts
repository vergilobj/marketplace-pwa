import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { UserRole } from '@prisma/client';

/**
 * GAPS-A: POST /notifications/broadcast.
 *
 * Было `@Body('message') message: string` + `@Body('role') role?: string`.
 * Пустое сообщение рассылалось всем; мусорная роль молча игнорировалась.
 */
export class BroadcastDto {
  @IsString()
  @IsNotEmpty({ message: 'message обязателен' })
  @MaxLength(1000)
  message: string;

  @IsOptional()
  @IsIn(Object.values(UserRole) as string[], {
    message: 'role должен быть BUYER|SELLER|MODERATOR|ADMIN',
  })
  role?: string;
}