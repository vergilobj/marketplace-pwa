import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { SettingsModule } from '../settings/settings.module';
import { NowPaymentsProvider } from './nowpayments.provider';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymodProvider } from './paymod.provider';
import { PaymodService } from './paymod.service';
import { PaymodWebhookController } from './paymod-webhook.controller';
import { PaymodWebhookHandler } from './paymod-webhook.handler';
import { LedgerService } from './ledger.service';
import { EscrowService } from './escrow.service';
import { AdActivationHook } from './ad-activation.hook';

@Module({
  imports: [SettingsModule, AuthModule, NotificationsModule],
  controllers: [PaymentsController, PaymodWebhookController],
  providers: [
    PaymentsService,
    LedgerService,
    EscrowService,
    NowPaymentsProvider,
    PaymodProvider,
    PaymodService,
    PaymodWebhookHandler,
    // NH5-ad: DI-мост «депозит подтверждён → активация рекламы».
    AdActivationHook,
  ],
  exports: [
    PaymentsService,
    PaymodService,
    LedgerService,
    EscrowService,
    AdActivationHook,
  ],
})
export class PaymentsModule {}
