import { Module } from '@nestjs/common';
import { InvitesService } from './invites.service';
import { InvitesController } from './invites.controller';
import { AuditService } from '../common/audit/audit.service';

@Module({
  controllers: [InvitesController],
  providers: [InvitesService, AuditService],
  exports: [InvitesService],
})
export class InvitesModule {}
