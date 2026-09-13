import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Request,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { OptionalJwtForPasswordGuard } from './optional-jwt-for-password.guard';
import type { AuthenticatedRequest } from '../common/types/authenticated-request.interface';

const INVALID_REFRESH = 'Некорректный токен обновления';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  /**
   * FIX-AUTH (A-4): ответ НЕ зависит от того, занят телефон или нет —
   * иначе register превращался в оракул существования пользователя.
   */
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /**
   * FIX-AUTH (A-2): токен проверяется целиком в сервисе — подпись, `jti`,
   * запись в БД, ротация и reuse detection. Декодировать payload здесь
   * больше не нужно (и вредно: доверие к неподписанному base64).
   */
  @Post('refresh')
  async refresh(@Body('refreshToken') refreshToken: string) {
    if (!refreshToken || typeof refreshToken !== 'string') {
      throw new UnauthorizedException('Требуется токен обновления');
    }

    return this.authService.refreshToken(refreshToken);
  }

  /**
   * FIX-AUTH (A-2): смена пароля гасит все refresh-токены пользователя и
   * выдаёт новую пару текущему устройству.
   */
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @UseGuards(OptionalJwtForPasswordGuard)
  @Post('change-password')
  async changePassword(
    @Request() req: AuthenticatedRequest,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(req.user.userId, dto);
  }
}