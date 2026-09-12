import { ArrayMinSize, IsArray, IsString, IsNotEmpty } from 'class-validator';

/**
 * A3: тело запроса общей оплаты корзины.
 *
 * Клиент присылает ТОЛЬКО идентификаторы заказов — суммы сервер берёт из БД
 * (иначе покупатель мог бы «оплатить» корзину на произвольную сумму).
 */
export class CartPayDto {
  @IsArray()
  @ArrayMinSize(2)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  orderIds: string[];
}
