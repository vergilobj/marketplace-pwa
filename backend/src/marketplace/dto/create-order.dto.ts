import { IsString, IsNotEmpty, IsNumber, Min } from 'class-validator';

export class CreateOrderDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsNumber()
  @Min(0)
  amount: number; // цена может отличаться? Пока равно цене продукта, но на будущее
}
