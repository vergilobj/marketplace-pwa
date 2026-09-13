import { UserRole } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsString,
} from 'class-validator';

/**
 * GAPS-A: PATCH /users/batch/role и PATCH /users/batch/approve.
 *
 * Было `@Body() body: { userIds: string[]; role: UserRole }` — инлайн-тип не
 * валидируется: `{userIds:"notarray",role:"ADMIN"}` → Prisma получала строку
 * в `id: { in: ... }` → PrismaClientValidationError → 500. Плюс `{}` на
 * batch/approve давал 200 «Users approved» (no-op).
 */
export class BatchRoleDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'userIds не может быть пустым' })
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  userIds: string[];

  @IsEnum(UserRole, { message: 'role должен быть BUYER|SELLER|MODERATOR|ADMIN' })
  role: UserRole;
}

export class BatchApproveDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'userIds не может быть пустым' })
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  userIds: string[];
}