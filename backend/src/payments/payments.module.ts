import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { SettingsModule } from '../settings/settings.module';
import { StubPaymentProvider } from './stub-payment.provider';
import { AuthModule } from '../auth/auth.module'; // <-- добавлено

@Module({
  imports: [SettingsModule, AuthModule], // <-- добавлен AuthModule
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    { provide: 'PAYMENT_PROVIDER', useClass: StubPaymentProvider },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}