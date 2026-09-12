import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AlertsService } from './alerts.service';

/**
 * Глобальный модуль внешних алертов.
 *
 * `@Global()` — чтобы AlertsService инжектился в LedgerService,
 * PaymentsService, ArbitrageService, UsersService и т.д. без правки каждого
 * feature-модуля (иначе пришлось бы тянуть импорт через пол-графа модулей и
 * рисковать циклами — в проекте уже разорван цикл AuthModule → UsersModule).
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}