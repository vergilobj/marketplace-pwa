import { Module } from '@nestjs/common';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';
import { NotificationsModule } from '../notifications/notifications.module';

/**
 * «Обратная связь». AlertsService подключать не нужно: AlertsModule помечен
 * @Global (см. app.module.ts), поэтому инстанс приходит из корня.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [FeedbackController],
  providers: [FeedbackService],
})
export class FeedbackModule {}