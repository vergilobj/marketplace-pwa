import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * FIX-AUTH (A-2): «гостевой» guard для смены пароля.
 *
 * `JwtStrategy` теперь всегда возвращает непустого `user` — доступ к БД на
 * каждом запросе и так есть. Значит, можно дать пользователю возможность
 * сменить пароль, даже когда access-токен уже протух (15 мин), — иначе
 * «пароль утёк, надо срочно сменить» упирается в истёкший токен и
 * единственный путь — заново логиниться утёкшим паролем.
 *
 * `handleRequest` здесь намеренно НЕ бросает 401 при `err` (истёкшая/битая
 * подпись), но бросает, если пользователь не идентифицирован вовсе
 * (`user` пустой — токена нет или он указывает на удалённого юзера).
 */
@Injectable()
export class OptionalJwtForPasswordGuard extends AuthGuard('jwt') {
  handleRequest<TUser = unknown>(
    _err: unknown,
    user: TUser,
    _info: unknown,
  ): TUser | null {
    if (!user) throw new UnauthorizedException();
    return user;
  }
}