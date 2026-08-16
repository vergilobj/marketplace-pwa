import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { SettingsModule } from '../settings/settings.module';
import { NowPaymentsProvider } from './nowpayments.provider';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [SettingsModule, AuthModule, NotificationsModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, NowPaymentsProvider],
  exports: [PaymentsService],
})
export class PaymentsModule {}
