import { IsString, IsNotEmpty } from 'class-validator';

export class SendBazarMessageDto {
  @IsString()
  @IsNotEmpty()
  text: string;
}
