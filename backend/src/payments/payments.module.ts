import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { SettingsModule } from '../settings/settings.module';
import { StubPaymentProvider } from './stub-payment.provider';

@Module({
  imports: [SettingsModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    { provide: 'PAYMENT_PROVIDER', useClass: StubPaymentProvider },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}