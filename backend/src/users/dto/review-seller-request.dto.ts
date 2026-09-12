import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * BUG-1: PATCH /users/seller-requests/:id — решение админа по заявке.
 *
 * Раньше контроллер принимал инлайн-тип `{ approve: boolean; note?: string }`
 * и делал `Boolean(body?.approve)`. При опечатке в имени поля (например
 * `{"status":"APPROVED"}`) `approve` был `undefined`, `Boolean(undefined)`
 * давал `false` → заявка МОЛЧА отклонялась с ответом 200.
 *
 * Теперь `approve` — обязательный строгий boolean: отсутствие поля или
 * неверное имя (лишнее поле ловит forbidNonWhitelisted) даёт 400, а не
 * тихое отклонение живого продавца.
 */
export class ReviewSellerRequestDto {
  @IsBoolean({ message: 'Поле approve обязательно и должно быть boolean' })
  approve: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}