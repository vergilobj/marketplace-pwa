import { IsString, IsNotEmpty, IsInt, Min, IsOptional } from 'class-validator';

export class CreateAdDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  content: string;

  @IsOptional()
  @IsString()
  link?: string;

  @IsInt()
  @Min(1)
  days: number; // на сколько дней размещение
}
