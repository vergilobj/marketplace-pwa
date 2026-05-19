import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class InvitesService {
  constructor(private prisma: PrismaService) {}

  async createInvite(ownerId: string) {
    const code = uuidv4();
    return this.prisma.invite.create({
      data: {
        code,
        ownerId,
      },
    });
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