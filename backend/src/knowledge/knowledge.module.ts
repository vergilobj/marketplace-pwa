import { Module, forwardRef } from '@nestjs/common';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';
import { ConsultModule } from '../consult/consult.module';
import { FeedbackModule } from '../feedback/feedback.module';

/**
 * База знаний консультанта (ЭТАП 3 ТЗ §6).
 *
 * Зависимости:
 *   - `ConsultModule` — `KnowledgeSearchService` (ранжирование §5.2 и
 *     нормализация уже написаны на Этапе 2, дублировать их нельзя);
 *   - `FeedbackModule` — `FeedbackService`: кандидаты рождаются из ответов
 *     админа в треде (§6.1 ПУТЬ A), а одобренное знание отмечается в треде
 *     сообщением kind=KNOWLEDGE.
 *
 * Связь с FeedbackModule ДВУСТОРОННЯЯ (там же создаётся кандидат), поэтому
 * обе стороны используют `forwardRef`. Цикл узкий: только эти два модуля и
 * только ради двух вызовов — создания кандидата и статистики треда.
 *
 * Cron устаревания знаний (§6.3) живёт внутри KnowledgeService.
 */
@Module({
  imports: [ConsultModule, forwardRef(() => FeedbackModule)],
  controllers: [KnowledgeController],
  providers: [KnowledgeService],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}