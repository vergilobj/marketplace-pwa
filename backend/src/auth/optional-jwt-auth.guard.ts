import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { AuthenticatedUser } from '../common/types/authenticated-request.interface';

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  /** Не роняем запрос при отсутствии/невалидности токена — просто user = null. */
  handleRequest<TUser = AuthenticatedUser>(err: unknown, user: TUser): TUser | null {
    return user || null;
  }
}
