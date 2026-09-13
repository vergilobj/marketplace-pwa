import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * GAPS-A: POST /bazar/products/generate.
 *
 * Было `@Body() body: { rawText: string }`. Пустое тело давало 201 с
 * `{"title":"undefined",...}` — LLM получал `""` как «товар». Теперь пустой
 * rawText → 400.
 */
export class GenerateDescriptionDto {
  @IsString()
  @IsNotEmpty({ message: 'rawText обязателен' })
  @MaxLength(5000)
  rawText: string;
}