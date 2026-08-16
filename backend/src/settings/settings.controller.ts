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
    return this.settingsService.set(body.key, body.value);
  }
}