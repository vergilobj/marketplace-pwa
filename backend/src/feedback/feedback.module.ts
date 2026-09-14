import { Module } from '@nestjs/common';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { ModerationModule } from '../moderation/moderation.module';

/**
 * «Обратная связь» — двусторонний тред с админом.
 *
 * AlertsService подключать не нужно: AlertsModule помечен @Global
 * (см. app.module.ts), поэтому инстанс приходит из корня.
 *
 * FeedbackService экспортируется: фолбэк ИИ-консультанта (ЭТАП 2) создаёт
 * тред через `create(userId, dto, 'WAITING_ADMIN')` — отдельного API для
 * этого не заводим.
 */
@Module({
  imports: [NotificationsModule, ModerationModule],
  controllers: [FeedbackController],
  providers: [FeedbackService],
  exports: [FeedbackService],
})
export class FeedbackModule {}
