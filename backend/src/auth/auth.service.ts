import { Injectable, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../common/prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { CometChatService } from '../cometchat/cometchat.service';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
    private cometChatService: CometChatService,
  ) {}

  async register(dto: RegisterDto) {
    // Проверить, не занят ли телефон
    const existingUser = await this.prisma.user.findUnique({ where: { phone: dto.phone } });
    if (existingUser) throw new ConflictException('Phone already registered');

    // Найти инвайт-код
    const invite = await this.prisma.invite.findUnique({ where: { code: dto.inviteCode } });
    if (!invite || invite.isUsed || (invite.expiresAt && invite.expiresAt < new Date())) {
      throw new BadRequestException('Invalid or expired invite code');
    }

    // Хешировать пароль
    const passwordHash = await bcrypt.hash(dto.password, 10);

    // Генерировать реферальный код (короткий на основе uuid)
    const referralCode = uuidv4().slice(0, 8);

    // Создать пользователя и пометить инвайт использованным в транзакции
    const user = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          phone: dto.phone,
          name: dto.name,
          passwordHash,
          role: 'BUYER', // по умолчанию покупатель
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

    await this.cometChatService.createUser(user.id, user.name || user.phone);

    return this.generateTokens(user);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { phone: dto.phone } });
    if (!user || !user.passwordHash) throw new UnauthorizedException('Invalid credentials');
    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');
  
    // Создать пользователя в CometChat, если его там ещё нет
    try {
      await this.cometChatService.createUser(user.id, user.name || user.phone);
    } catch (err) {}
  
    return this.generateTokens(user);
  }
  
  async refreshToken(userId: string, refreshToken: string) {
    // В будущем можно хранить refresh токены в Redis, пока пропустим
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

  private async generateTokens(user: any) {
    const payload = { sub: user.id, phone: user.phone, role: user.role };
    const accessToken = this.jwtService.sign(payload);
    const refreshToken = this.jwtService.sign(payload, {
      secret: this.config.get('JWT_REFRESH_SECRET'),
      expiresIn: '7d',
    });

    return { accessToken, refreshToken };
  }
}