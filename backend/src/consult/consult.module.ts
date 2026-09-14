import { Module, forwardRef } from '@nestjs/common';
import { ConsultController } from './consult.controller';
import { ConsultService } from './consult.service';
import { KnowledgeSearchService } from './knowledge-search.service';
import { BazarModule } from '../bazar/bazar.module';
import { FeedbackModule } from '../feedback/feedback.module';
import { ModerationModule } from '../moderation/moderation.module';
import { SettingsModule } from '../settings/settings.module';

/**
 * ИИ-консультант «Базар» (ЭТАП 2 ТЗ §5.1, база знаний — ЭТАП 3 §6).
 *
 * Отдельный модуль, а не расширение BazarModule: Базар — про сделки и каталог,
 * консультант — про ответы на вопросы. Общий у них только транспорт к LLM,
 * который и берётся импортом (`BazarApiClient`, `CatalogSearchService`).
 *
 * Единственная точка вызова LLM остаётся одна — `BazarApiClient.complete()`.
 *
 * Чего здесь НЕТ:
 *   - KnowledgeModule (`knowledge.service.ts`, `knowledge.controller.ts`) —
 *     он импортирует ЭТОТ модуль ради `KnowledgeSearchService`, обратной
 *     зависимости нет (иначе цикл). CRUD базы знаний живёт в KnowledgeModule;
 *   - ConsultCron (автозакрытие тредов + устаревание знаний) — автозакрытие
 *     тредов живёт в `FeedbackService.autoCloseStaleThreads` (§4.3),
 *     устаревание знаний — в `KnowledgeService.runMaintenance` (§6.3).
 */
@Module({
  imports: [
    BazarModule,
    forwardRef(() => FeedbackModule),
    ModerationModule,
    SettingsModule,
  ],
  controllers: [ConsultController],
  providers: [ConsultService, KnowledgeSearchService],
  exports: [ConsultService, KnowledgeSearchService],
})
export class ConsultModule {}