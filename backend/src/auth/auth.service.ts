import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../common/prisma/prisma.service';
import { CometChatService } from '../cometchat/cometchat.service';
import { AuditService } from '../common/audit/audit.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
    private cometChatService: CometChatService,
    private auditService: AuditService,
  ) {}

  async register(dto: RegisterDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
    });
    if (existingUser) throw new ConflictException('Phone already registered');

    const invite = await this.prisma.invite.findUnique({
      where: { code: dto.inviteCode },
    });
    if (
      !invite ||
      invite.isUsed ||
      (invite.expiresAt && invite.expiresAt < new Date())
    ) {
      throw new BadRequestException('Invalid or expired invite code');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
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

    // Создать пользователя в CometChat
    try {
      await this.cometChatService.createUser(user.id, user.name || user.phone);
      this.logger.log(`CometChat user created for ${user.id}`);
    } catch (err) {
      this.logger.warn(
        `Could not create CometChat user for ${user.id}: ${err.message}`,
      );
    }

    await this.auditService.log({
      userId: user.id,
      action: 'register',
      entity: 'user',
      entityId: user.id,
    });

    return this.generateTokens(user);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
    });

    // Constant-time check to prevent user enumeration
    const dummyHash =
      '$2b$10$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const hash = user?.passwordHash || dummyHash;
    const valid = await bcrypt.compare(dto.password, hash);

    if (!user || !valid) {
      throw new UnauthorizedException('Invalid phone or password');
    }

    await this.auditService.log({
      userId: user.id,
      action: 'login',
      entity: 'user',
      entityId: user.id,
    });

    // Sync missing users with CometChat (fire-and-forget — don't block login)
    this.syncAllUsersWithCometChat().catch((err) =>
      this.logger.warn('Background sync failed', err),
    );

    return this.generateTokens(user);
  }

  async refreshToken(userId: string, refreshToken: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();

    try {
      this.jwtService.verify(refreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return this.generateTokens(user);
  }

  private async syncAllUsersWithCometChat() {
    try {
      const users = await this.prisma.user.findMany({
        select: { id: true, name: true, phone: true, cometChatUid: true },
      });

      for (const user of users) {
        if (!user.cometChatUid) {
          try {
            await this.cometChatService.createUser(
              user.id,
              user.name || user.phone,
            );
            await this.prisma.user.update({
              where: { id: user.id },
              data: { cometChatUid: user.id },
            });
            this.logger.log(`Synced user ${user.id} with CometChat`);
          } catch (err) {
            if (err.code !== 'ERR_UID_ALREADY_EXISTS') {
              this.logger.warn(
                `Failed to sync user ${user.id}: ${err.message}`,
              );
            }
          }
        }
      }
    } catch (err) {
      this.logger.error('Failed to sync users with CometChat', err);
    }
  }

  private generateTokens(user: any) {
    const payload = { sub: user.id, phone: user.phone, role: user.role };
    const accessToken = this.jwtService.sign(payload);
    const refreshToken = this.jwtService.sign(payload, {
      secret: this.config.get('JWT_REFRESH_SECRET'),
      expiresIn: '7d',
    });

    return { accessToken, refreshToken };
  }
}
