import { Module } from '@nestjs/common';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { SettingsModule } from '../settings/settings.module';
import { PaymentsModule } from '../payments/payments.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditService } from '../common/audit/audit.service';
import { ModerationModule } from '../moderation/moderation.module';

@Module({
  imports: [SettingsModule, PaymentsModule, AuthModule, NotificationsModule, ModerationModule],
  controllers: [PostsController],
  providers: [PostsService, AuditService],
})
export class PostsModule {}
