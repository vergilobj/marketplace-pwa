import {
  Controller,
  Get,
  Put,
  Body,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { SettingsService } from './settings.service';
import { UpdateSettingDto } from './dto/update-setting.dto';

/**
 * Числовые границы для настроек (N1).
 *
 * Валидация живёт в контроллере — как и для `platform_fee_percent`/
 * `referral_percent`/`ad_price` (в `SettingsService` проверок значений нет).
 * `min`/`max` — включительные, `integer` — требовать целое (дни/минуты).
 *
 * Границы подобраны так, чтобы:
 *  - не ломать текущие рабочие значения (1 / 15 / 5 / 7 / 0);
 *  - отсекать мусор, который ломает деньги и сроки: отрицательные TTL и сроки
 *    (заказ отменялся бы мгновенно / эскроу не имел бы дедлайна), допуск
 *    недоплаты > 100% (подтверждение платежа за долю суммы), отрицательный
 *    минимум вывода (любая сумма проходила бы).
 */
const NUMERIC_RANGES: Record<
  string,
  { min: number; max?: number; integer?: boolean; label: string }
> = {
  // допуск недоплаты: код трактует 0/невалид как дефолт 1, >100% — абсурд
  deposit_tolerance_percent: { min: 0, max: 100, label: 'процент 0..100' },
  // TTL оплаты: < 1 мин отменял бы заказ сразу, > 1440 (сутки) — не TTL
  order_payment_ttl_minutes: {
    min: 1,
    max: 1440,
    integer: true,
    label: 'целое число минут 1..1440',
  },
  // дедлайн отправки продавцом
  escrow_ship_deadline_days: {
    min: 1,
    max: 90,
    integer: true,
    label: 'целое число дней 1..90',
  },
  // авто-завершение заказа → релиз эскроу
  escrow_autocomplete_days: {
    min: 1,
    max: 90,
    integer: true,
    label: 'целое число дней 1..90',
  },
  // минимум вывода: 0 = без минимума (текущее значение)
  withdrawal_min_amount: { min: 0, label: 'неотрицательное число USDT' },
};

@Controller('settings')
export class SettingsController {
  constructor(private settingsService: SettingsService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get()
  async getAll() {
    return this.settingsService.getAll();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Put()
  async update(@Body() body: UpdateSettingDto) {
    if (
      body.key === 'platform_fee_percent' ||
      body.key === 'referral_percent'
    ) {
      const num = Number(body.value);
      if (!Number.isFinite(num) || num < 0 || num > 100) {
        throw new BadRequestException(
          `${body.key} must be a number between 0 and 100`,
        );
      }
    }
    if (body.key === 'ad_price') {
      const num = Number(body.value);
      if (!Number.isFinite(num) || num < 0) {
        throw new BadRequestException('ad_price must be a non-negative number');
      }
    }

    const range = NUMERIC_RANGES[body.key];
    if (range) {
      // Пустая строка → Number('') === 0: для денежных настроек это мусор,
      // который молча прошёл бы как «0», поэтому отсекаем отдельно.
      const raw = body.value.trim();
      const num = raw === '' ? NaN : Number(raw);
      const invalid =
        !Number.isFinite(num) ||
        num < range.min ||
        (range.max !== undefined && num > range.max) ||
        (range.integer === true && !Number.isInteger(num));
      if (invalid) {
        throw new BadRequestException(
          `${body.key} must be a ${range.label}`,
        );
      }
    }

    return this.settingsService.set(body.key, body.value);
  }
}