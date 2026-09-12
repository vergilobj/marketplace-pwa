import { IsString, IsNotEmpty, IsIn } from 'class-validator';

/**
 * Ключи настроек, которые разрешено менять через `PUT /settings`.
 *
 * N1: раньше здесь было 4 ключа, но код читает ещё 5 «денежных» настроек
 * (`deposit_tolerance_percent`, `order_payment_ttl_minutes`,
 * `escrow_ship_deadline_days`, `escrow_autocomplete_days`,
 * `withdrawal_min_amount`) — их можно было поменять только прямым SQL.
 *
 * Границы значений проверяет контроллер (`SettingsController.update`) —
 * там же, где уже валидируются `platform_fee_percent`/`referral_percent`/
 * `ad_price`.
 */
export const SETTING_KEYS = [
  'platform_fee_percent',
  'referral_percent',
  'ad_price',
  'stop_words',
  'deposit_tolerance_percent',
  'order_payment_ttl_minutes',
  'escrow_ship_deadline_days',
  'escrow_autocomplete_days',
  'withdrawal_min_amount',
] as const;

export class UpdateSettingDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(SETTING_KEYS as unknown as string[])
  key: string;

  @IsString()
  @IsNotEmpty()
  value: string;
}