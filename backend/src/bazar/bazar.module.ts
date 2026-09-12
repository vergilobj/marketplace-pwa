import { Module } from '@nestjs/common';
import { BazarController } from './bazar.controller';
import { BazarService } from './bazar.service';
import { BazarApiClient } from './bazar.api-client';
import { CatalogSearchService } from './catalog-search.service';
import { DealService } from './deal.service';
import { DealTimeoutService } from './deal-timeout.service';
import { IntentDispatcher } from './intent-dispatcher.service';
import { AutopilotService } from './autopilot.service';
import { ReputationService } from './reputation.service';
import { ProactiveService } from './proactive.service';
import { ArbitrageService } from './arbitrage.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { ModerationModule } from '../moderation/moderation.module';
import { PaymentsModule } from '../payments/payments.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    NotificationsModule,
    ModerationModule,
    PaymentsModule,
    SettingsModule,
  ],
  controllers: [BazarController],
  providers: [
    BazarService,
    BazarApiClient,
    CatalogSearchService,
    DealService,
    DealTimeoutService,
    IntentDispatcher,
    AutopilotService,
    ReputationService,
    ProactiveService,
    ArbitrageService,
  ],
  exports: [BazarService, BazarApiClient, DealService],
})
export class BazarModule {}
