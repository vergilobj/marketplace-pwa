import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private prisma: PrismaService) {}

  async log(params: {
    userId?: string;
    action: string;
    entity?: string;
    entityId?: string;
    ip?: string;
    userAgent?: string;
    metadata?: Record<string, unknown>;
  }) {
    try {
      await this.prisma.auditLog.create({ 
        data: {
          userId: params.userId ?? null,
          action: params.action,
          entity: params.entity ?? null,
          entityId: params.entityId ?? null,
          ip: params.ip ?? null,
          userAgent: params.userAgent ?? null,
          metadata: params.metadata as any ?? undefined,
        }
      });
    } catch (err) {
      this.logger.warn(`Failed to write audit log: ${err.message}`);
    }
  }
}
