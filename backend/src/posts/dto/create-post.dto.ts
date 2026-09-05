import { IsString, IsNotEmpty, IsOptional, IsArray } from 'class-validator';

export class CreatePostDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  content: string;

  @IsOptional()
  @IsString()
  link?: string;

  @IsOptional()
  @IsArray()
  media?: string[];

  @IsOptional()
  @IsString()
  videoUrl?: string;
}
