import { Module } from '@nestjs/common';
import { ConsultController } from './consult.controller';
import { ConsultService } from './consult.service';
import { KnowledgeSearchService } from './knowledge-search.service';
import { BazarModule } from '../bazar/bazar.module';
import { FeedbackModule } from '../feedback/feedback.module';
import { ModerationModule } from '../moderation/moderation.module';
import { SettingsModule } from '../settings/settings.module';

/**
 * ИИ-консультант «Базар» (ЭТАП 2 ТЗ §5.1).
 *
 * Отдельный модуль, а не расширение BazarModule: Базар — про сделки и каталог,
 * консультант — про ответы на вопросы. Общий у них только транспорт к LLM,
 * который и берётся импортом (`BazarApiClient`, `CatalogSearchService`).
 *
 * Единственная точка вызова LLM остаётся одна — `BazarApiClient.complete()`.
 *
 * Чего здесь НЕТ на этом этапе:
 *   - KnowledgeModule (`knowledge.service.ts`, `knowledge.controller.ts`) —
 *     база знаний создаётся на Этапе 3 (§6). `KnowledgeSearchService` уже
 *     готов к ней и отдаёт пустой результат, пока таблицы нет;
 *   - ConsultCron (автозакрытие тредов + устаревание знаний) — автозакрытие
 *     тредов уже живёт в `FeedbackService.autoCloseStaleThreads` (§4.3),
 *     устареванию знаний нужна таблица знаний.
 */
@Module({
  imports: [
    BazarModule,
    FeedbackModule,
    ModerationModule,
    SettingsModule,
  ],
  controllers: [ConsultController],
  providers: [ConsultService, KnowledgeSearchService],
  exports: [ConsultService, KnowledgeSearchService],
})
export class ConsultModule {}