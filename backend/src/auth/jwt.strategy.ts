import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';

/**
 * Payload access-токена (см. AuthService.generateTokens).
 *
 * `nonce` (FIX-AUTH A-2) — id строки RefreshToken, из которой выдан этот
 * access-токен. Нужен `changePassword`, чтобы отозвать актуальную цепочку.
 */
export interface JwtPayload {
  sub: string;
  phone: string;
  role: UserRole;
  nonce?: string;
}

/**
 * FIX-AUTH (A-1): стратегия больше не доверяет payload'у.
 *
 * Раньше `validate()` возвращал `{userId, phone, role}` прямо из токена, из-за
 * чего понижение роли и удаление пользователя не действовали до истечения
 * access-токена (15 мин), а `RolesGuard` читал устаревшую роль из токена.
 *
 * Теперь на каждый авторизованный запрос идёт один `findUnique` по PK с
 * `select` из трёх полей; роль/телефон/наличие юзера берутся из БД.
 * Удалён → 401. Понижен → 403 на следующем же запросе к защищённому роуту.
 *
 * ⚠️ Честно: поля бана (`isBlocked`/`isBanned`) в схеме `User` НЕТ и новых
 * полей заводить нельзя (схему делят билдеры). Бан в проекте физически не
 * выражен — закрыть эту половину A-1 нечем, см. report.md. Как только поле
 * появится в schema.prisma, сюда добавится `select: { isBlocked: true }` и
 * `ForbiddenException`.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // FIX-AUTH (A-3): алгоритм зафиксирован — токен с другим alg (в т.ч.
      // alg:none) отвергается до проверки подписи.
      algorithms: ['HS256'],
      secretOrKey: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, phone: true, role: true },
    });

    if (!user) throw new UnauthorizedException();

    return { userId: user.id, phone: user.phone, role: user.role };
  }
}