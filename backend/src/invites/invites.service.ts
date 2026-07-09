import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

// Генерация красивого короткого кода (8 символов, без похожих букв/цифр)
function generateShortCode(length = 8): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

@Injectable()
export class InvitesService {
  constructor(private prisma: PrismaService) {}

  async createInvite(ownerId: string, customCode?: string) {
    if (customCode) {
      // Проверить, что такой код ещё не занят
      const existing = await this.prisma.invite.findUnique({
        where: { code: customCode },
      });
      if (existing) {
        throw new BadRequestException('Invite code already exists');
      }
      return this.prisma.invite.create({
        data: { code: customCode, ownerId },
      });
    }

    // Автоматическая генерация красивого кода (до 10 попыток)
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = generateShortCode();
      const existing = await this.prisma.invite.findUnique({ where: { code } });
      if (!existing) {
        return this.prisma.invite.create({
          data: { code, ownerId },
        });
      }
    }
    throw new BadRequestException('Could not generate a unique invite code');
  }

  async findAll() {
    return this.prisma.invite.findMany({
      include: {
        owner: { select: { id: true, name: true } },
        usedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async delete(code: string) {
    return this.prisma.invite.delete({ where: { code } });
  }
}
