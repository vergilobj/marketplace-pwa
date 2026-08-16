import { Module } from '@nestjs/common';
import { SocialController } from './social.controller';
import { SocialService } from './social.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditService } from '../common/audit/audit.service';

@Module({
  imports: [NotificationsModule],
  controllers: [SocialController],
  providers: [SocialService, AuditService],
})
export class SocialModule {}
