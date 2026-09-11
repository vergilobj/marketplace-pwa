import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsInt,
  Min,
  Max,
} from 'class-validator';

export class CreateOrderDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  /**
   * LEGACY, IGNORED. Покупатель не задаёт цену — amount всегда берётся из
   * product.price (см. OrdersService.create). Поле оставлено в DTO только
   * потому, что фронт (frontend/src/api/orders.ts) всё ещё его отправляет,
   * а ValidationPipe настроен с forbidNonWhitelisted: true — удаление поля
   * ломало бы чекаут 400-й ошибкой.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  /** Количество единиц товара. Цена считается как product.price * quantity. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  quantity?: number;
}
