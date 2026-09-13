import { UserRole } from '@prisma/client';
import { IsEnum } from 'class-validator';

/**
 * GAPS-A: PATCH /users/:id/role.
 *
 * Было `@Body('role') role: UserRole` — сырое значение уходило в
 * `prisma.user.update`. `{"role":"SUPERUSER"}` и `{}` давали
 * PrismaClientValidationError → 500 вместо 400.
 */
export class ChangeUserRoleDto {
  @IsEnum(UserRole, { message: 'role должен быть BUYER|SELLER|MODERATOR|ADMIN' })
  role: UserRole;
}