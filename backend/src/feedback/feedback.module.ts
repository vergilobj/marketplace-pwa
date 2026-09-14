import { Module, forwardRef } from '@nestjs/common';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { ModerationModule } from '../moderation/moderation.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';

/**
 * «Обратная связь» — двусторонний тред с админом.
 *
 * AlertsService подключать не нужно: AlertsModule помечен @Global
 * (см. app.module.ts), поэтому инстанс приходит из корня.
 *
 * FeedbackService экспортируется: фолбэк ИИ-консультанта (ЭТАП 2) создаёт
 * тред через `create(userId, dto, 'WAITING_ADMIN')` — отдельного API для
 * этого не заводим.
 *
 * `KnowledgeModule` — через forwardRef: ответ админа в треде становится
 * кандидатом в базу знаний (ЭТАП 3 §6.1 ПУТЬ A), а KnowledgeService взамен
 * берёт здесь статистику треда.
 */
@Module({
  imports: [
    NotificationsModule,
    ModerationModule,
    // forwardRef: ответ админа в треде рождает кандидата в базу знаний
    // (ЭТАП 3 §6.1 ПУТЬ A), а KnowledgeModule при этом зависит от ConsultModule,
    // который сам зависит от FeedbackModule — цепочка замыкается, поэтому ref.
    forwardRef(() => KnowledgeModule),
  ],
  controllers: [FeedbackController],
  providers: [FeedbackService],
  exports: [FeedbackService],
})
export class FeedbackModule {}
