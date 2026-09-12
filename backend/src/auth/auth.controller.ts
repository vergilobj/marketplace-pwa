import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

const INVALID_REFRESH = 'Некорректный токен обновления';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

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

  @Post('refresh')
  async refresh(@Body('refreshToken') refreshToken: string) {
    if (!refreshToken || typeof refreshToken !== 'string') {
      throw new UnauthorizedException('Требуется токен обновления');
    }

    // Разбор payload без доверия к входу: мусор → 401, а не 500.
    let decoded: { sub?: string };
    try {
      const parts = refreshToken.split('.');
      if (parts.length !== 3 || !parts[1]) {
        throw new Error('malformed');
      }
      const parsed = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      if (!parsed || typeof parsed !== 'object' || !parsed.sub) {
        throw new Error('malformed');
      }
      decoded = parsed;
    } catch {
      throw new UnauthorizedException(INVALID_REFRESH);
    }

    // Криптопроверка как была — auth.service.refreshToken (verify).
    return this.authService.refreshToken(decoded.sub as string, refreshToken);
  }
}
