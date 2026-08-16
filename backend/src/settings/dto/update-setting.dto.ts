import { IsString, IsNotEmpty, IsIn } from 'class-validator';

export class UpdateSettingDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['platform_fee_percent', 'referral_percent', 'ad_price', 'stop_words'])
  key: string;

  @IsString()
  @IsNotEmpty()
  value: string;
}