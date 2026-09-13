import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

/** Минимальный набор полей пользователя, нужный для подписи JWT. */
type TokenUser = { id: string; phone: string; role: string };

/** Клиент Prisma внутри $transaction либо обычный PrismaService. */
type Db = PrismaService | Prisma.TransactionClient;

/** Стоимость bcrypt — одна на весь сервис (иначе тайминг ответов врёт). */
const BCRYPT_ROUNDS = 10;

/** Срок жизни refresh-токена. */
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_TTL = '7d';

/** Единый текст ошибки refresh — не подсказываем, ЧТО именно не так. */
const INVALID_REFRESH = 'Неверный токен обновления';

/**
 * Хеш-заглушка для constant-time проверок в `login`.
 * Считается один раз на процесс: bcrypt.compare по ней занимает столько же,
 * сколько по настоящему хешу, поэтому «пользователя нет» и «пароль неверный»
 * не различимы по времени.
 */
const DUMMY_HASH = bcrypt.hashSync('forge-dummy-password', BCRYPT_ROUNDS);

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
    private auditService: AuditService,
  ) {}

  /**
   * FIX-AUTH (A-4): регистрация больше не отвечает 409 «Телефон уже
   * зарегистрирован» — иначе защита от энумерации в `login` (dummy-hash)
   * обесценивалась: перебором телефонов через register выяснялось, кто есть
   * в базе, а дальше логин добивался перебором пароля.
   *
   * Выбран вариант 1 (одинаковый ответ), а не 409+CAPTCHA: CAPTCHA на проекте
   * нет, а сам код 409 и есть утечка. Оба случая возвращают один и тот же
   * `{accessToken, refreshToken}` с сопоставимым временем ответа (bcrypt
   * считается в обеих ветках), поэтому фронт (`RegisterPage.tsx:30`) не ломается.
   *
   * ⚠️ Для занятого телефона пользователь НЕ создаётся, инвайт НЕ сжигается,
   * а выданные токены заведомо нерабочие (`decoyTokens`) — аккаунт не забрать.
   * ⚠️ Энумерация закрыта не полностью: верификации телефона (SMS) в проекте
   * нет, а register сразу выдаёт рабочие токены, поэтому внимательный
   * атакующий отличит рабочий токен от нерабочего. Полное закрытие требует
   * шага подтверждения номера — вне рамок A-4 (см. report.md).
   */
  async register(dto: RegisterDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
      select: { id: true },
    });

    if (existingUser) {
      // Выравниваем время ответа: та же стоимость bcrypt, результат не нужен.
      await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

      await this.auditService.log({
        userId: existingUser.id,
        action: 'register_duplicate_phone_attempt',
        entity: 'user',
        entityId: existingUser.id,
        metadata: { phone: dto.phone },
      });

      // Уведомляем владельца номера (best-effort, ответ не зависит).
      try {
        await this.prisma.notification.create({
          data: {
            userId: existingUser.id,
            type: 'security',
            message:
              'Кто-то пытался зарегистрироваться на ваш номер. Если это были не вы — смените пароль.',
          },
        });
      } catch (err) {
        this.logger.warn(
          `Duplicate-phone notification failed: ${(err as Error).message}`,
        );
      }

      return this.decoyTokens(dto.phone);
    }

    const invite = await this.prisma.invite.findUnique({
      where: { code: dto.inviteCode },
    });
    if (
      !invite ||
      invite.isUsed ||
      (invite.expiresAt && invite.expiresAt < new Date())
    ) {
      throw new BadRequestException('Неверный или истёкший код приглашения');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const referralCode = uuidv4().slice(0, 8);

    const user = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          phone: dto.phone,
          name: dto.name,
          passwordHash,
          role: 'BUYER',
          invitedById: invite.ownerId,
          referralCode,
        },
      });

      await tx.invite.update({
        where: { code: invite.code },
        data: { isUsed: true, usedById: newUser.id },
      });

      return newUser;
    });

    await this.auditService.log({
      userId: user.id,
      action: 'register',
      entity: 'user',
      entityId: user.id,
    });

    return this.generateTokens(user);
  }

  async login(dto: LoginDto) {
    // FIX-CRIT: глобальный `omit` в PrismaService по умолчанию вырезает
    // `passwordHash`. Здесь он НУЖЕН для bcrypt.compare → запрашиваем явно.
    const user = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
      omit: { passwordHash: false },
    });

    // Constant-time check to prevent user enumeration
    const hash = user?.passwordHash || DUMMY_HASH;
    const valid = await bcrypt.compare(dto.password, hash);

    if (!user || !valid) {
      throw new UnauthorizedException('Неверный телефон или пароль');
    }

    await this.auditService.log({
      userId: user.id,
      action: 'login',
      entity: 'user',
      entityId: user.id,
    });

    return this.generateTokens(user);
  }

  /**
   * FIX-AUTH (A-2): refresh-токен одноразовый.
   *
   * Было: токен жил 7 дней, нигде не хранился и не отзывался; повторное
   * использование украденного токена не детектировалось, смена пароля ничего
   * не гасила.
   *
   * Стало: в payload refresh-токена едет `jti`, на каждый выпуск пишется
   * строка `RefreshToken`. Успешный refresh АТОМАРНО (updateMany с
   * `revokedAt: null` в условии) отзывает старую строку и выдаёт новую пару —
   * из двух параллельных запросов со старым токеном пройдёт ровно один.
   * Приход с уже отозванным `jti` = кража → ревокается ВСЯ цепочка юзера.
   */
  async refreshToken(refreshToken: string) {
    const payload = this.verifyRefreshToken(refreshToken);

    const row = await this.prisma.refreshToken.findUnique({
      where: { jti: payload.jti },
    });

    if (!row || row.userId !== payload.sub) {
      throw new UnauthorizedException(INVALID_REFRESH);
    }

    // REUSE DETECTION: токен уже был использован (или отозван сменой пароля).
    //
    // Различаем два вида отзыва (по `replacedById`, других полей в схеме нет):
    //   - replacedById ЗАПОЛНЕН → токен был обменян на новый (ротация) и
    //     пришёл ПОВТОРНО = признак кражи → гасим всю цепочку;
    //   - replacedById ПУСТ → токен отозван административно (смена пароля,
    //     предыдущая ревокация цепочки). Повтор такого токена — 401, но
    //     текущие сессии не трогаем: иначе достаточно одного старого
    //     refresh-токена, чтобы выбить пользователя из всех устройств.
    if (row.revokedAt) {
      if (row.replacedById) {
        await this.onReuseDetected(row.userId, row.jti);
      } else {
        await this.auditService.log({
          userId: row.userId,
          action: 'refresh_token_revoked_replay',
          entity: 'user',
          entityId: row.userId,
          metadata: { jti: row.jti },
        });
      }
      throw new UnauthorizedException(INVALID_REFRESH);
    }

    if (row.expiresAt < new Date()) {
      throw new UnauthorizedException(INVALID_REFRESH);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: row.userId },
      select: { id: true, phone: true, role: true },
    });
    if (!user) throw new UnauthorizedException(INVALID_REFRESH);

    const issued = await this.prisma.$transaction(async (tx) => {
      // Атомарный «захват»: если параллельный запрос уже отозвал jti —
      // count=0, и это тоже reuse (гонка двух запросов с одним токеном).
      const claim = await tx.refreshToken.updateMany({
        where: { jti: row.jti, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (claim.count === 0) return null;

      const tokens = await this.generateTokens(user, tx);
      await tx.refreshToken.update({
        where: { jti: row.jti },
        data: { replacedById: tokens.refreshId },
      });
      return tokens;
    });

    if (!issued) {
      await this.onReuseDetected(row.userId, row.jti, true);
      throw new UnauthorizedException(INVALID_REFRESH);
    }

    return {
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
    };
  }

  /**
   * FIX-AUTH (A-2): смена пароля гасит ВСЕ ранее выданные refresh-токены
   * пользователя и выдаёт новую пару текущему устройству.
   *
   * Раньше эндпоинта смены пароля не было вообще (ни в бэке, ни во фронте),
   * поэтому «смена пароля инвалидирует токены» проверить было нечем.
   */
  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      omit: { passwordHash: false },
    });
    if (!user || !user.passwordHash) throw new UnauthorizedException();

    const valid = await bcrypt.compare(dto.oldPassword, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Неверный текущий пароль');

    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    const revoked = await this.revokeAllForUser(userId);

    await this.auditService.log({
      userId,
      action: 'password_changed',
      entity: 'user',
      entityId: userId,
      metadata: { revokedTokens: revoked },
    });

    // Текущее устройство остаётся в системе: свежая пара уже после отзыва.
    return this.generateTokens({
      id: user.id,
      phone: user.phone,
      role: user.role,
    });
  }

  /** Ревокация всех активных refresh-токенов пользователя. */
  async revokeAllForUser(userId: string): Promise<number> {
    const res = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return res.count;
  }

  /** Единая реакция на reuse: ревокация всей цепочки + запись в аудит. */
  private async onReuseDetected(
    userId: string,
    jti: string,
    race = false,
  ): Promise<void> {
    const revoked = await this.revokeAllForUser(userId);
    await this.auditService.log({
      userId,
      action: 'refresh_token_reuse_detected',
      entity: 'user',
      entityId: userId,
      metadata: { jti, revokedCount: revoked, race },
    });
    this.logger.error(
      `Refresh token reuse detected for user ${userId} (jti=${jti}` +
        `${race ? ', race' : ''}); revoked ${revoked} active token(s)`,
    );
  }

  /**
   * FIX-AUTH (A-4): заведомо нерабочая пара токенов для ответа на регистрацию
   * с уже занятым телефоном.
   *
   * `sub` — случайный uuid, которого нет в БД, поэтому:
   *   - access-токен не даёт доступа: `JwtStrategy.validate` → 401;
   *   - refresh-токен не даёт доступа: строки с таким `jti` нет → 401.
   * Выдать настоящие токены существующего пользователя было бы захватом
   * аккаунта без пароля.
   */
  private decoyTokens(phone: string) {
    const payload = { sub: uuidv4(), phone, role: 'BUYER' };
    return {
      accessToken: this.jwtService.sign(payload),
      refreshToken: this.jwtService.sign(
        { ...payload, jti: uuidv4() },
        {
          secret: this.config.get('JWT_REFRESH_SECRET'),
          expiresIn: REFRESH_TTL,
          algorithm: 'HS256',
        },
      ),
    };
  }

  /**
   * Проверка подписи refresh-токена.
   *
   * FIX-AUTH (A-3): `algorithms: ['HS256']` — иначе алгоритм брался бы из
   * заголовка токена (в т.ч. `none`).
   */
  private verifyRefreshToken(token: string): { sub: string; jti: string } {
    try {
      const payload = this.jwtService.verify<{ sub?: string; jti?: string }>(
        token,
        {
          secret: this.config.get('JWT_REFRESH_SECRET'),
          algorithms: ['HS256'],
        },
      );
      if (!payload?.sub || !payload?.jti) {
        throw new Error('missing claims');
      }
      return { sub: payload.sub, jti: payload.jti };
    } catch {
      throw new UnauthorizedException(INVALID_REFRESH);
    }
  }

  /**
   * Выдача пары токенов + запись строки RefreshToken.
   * `refreshId` — id строки (для `replacedById` при ротации).
   */
  private async generateTokens(user: TokenUser, db: Db = this.prisma) {
    const jti = uuidv4();
    const payload = { sub: user.id, phone: user.phone, role: user.role };

    const accessToken = this.jwtService.sign(payload);
    const refreshToken = this.jwtService.sign(
      { ...payload, jti },
      {
        secret: this.config.get('JWT_REFRESH_SECRET'),
        expiresIn: REFRESH_TTL,
        algorithm: 'HS256',
      },
    );

    const row = await db.refreshToken.create({
      data: {
        jti,
        userId: user.id,
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
      select: { id: true },
    });

    return { accessToken, refreshToken, refreshId: row.id };
  }
}