import { Module } from '@nestjs/common';
import { SocialController } from './social.controller';
import { SocialService } from './social.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditService } from '../common/audit/audit.service';
import { ModerationModule } from '../moderation/moderation.module';

@Module({
  imports: [NotificationsModule, ModerationModule],
  controllers: [SocialController],
  providers: [SocialService, AuditService],
})
export class SocialModule {}
