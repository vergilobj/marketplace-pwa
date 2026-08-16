import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';

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
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
  ) {}

  async createInvite(ownerId: string, customCode?: string) {
    let invite;
    if (customCode) {
      // Проверить, что такой код ещё не занят
      const existing = await this.prisma.invite.findUnique({
        where: { code: customCode },
      });
      if (existing) {
        throw new BadRequestException('Invite code already exists');
      }
      invite = await this.prisma.invite.create({
        data: { code: customCode, ownerId },
      });
    } else {
      // Автоматическая генерация красивого кода (до 10 попыток)
      for (let attempt = 0; attempt < 10; attempt++) {
        const code = generateShortCode();
        const existing = await this.prisma.invite.findUnique({ where: { code } });
        if (!existing) {
          invite = await this.prisma.invite.create({
            data: { code, ownerId },
          });
          break;
        }
      }
      if (!invite) {
        throw new BadRequestException('Could not generate a unique invite code');
      }
    }

    await this.auditService.log({
      userId: ownerId,
      action: 'invite_created',
      entity: 'invite',
      entityId: invite.code,
    });

    return invite;
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
    const deleted = await this.prisma.invite.delete({ where: { code } });
    await this.auditService.log({
      action: 'invite_deleted',
      entity: 'invite',
      entityId: code,
    });
    return deleted;
  }
}
