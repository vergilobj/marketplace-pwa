import { Module } from '@nestjs/common';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { SettingsModule } from '../settings/settings.module';
import { PaymentsModule } from '../payments/payments.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditService } from '../common/audit/audit.service';

@Module({
  imports: [SettingsModule, PaymentsModule, AuthModule, NotificationsModule],
  controllers: [PostsController],
  providers: [PostsService, AuditService],
})
export class PostsModule {}
