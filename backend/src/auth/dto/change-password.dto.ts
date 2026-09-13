import { IsString, IsNotEmpty, MinLength } from 'class-validator';

/**
 * FIX-AUTH (A-2): смена пароля — единственный способ инвалидировать уже
 * выданные refresh-токены (эндпоинта раньше не было вообще).
 */
export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  oldPassword: string;

  @IsString()
  @MinLength(6)
  newPassword: string;
}