import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PaymentsModule } from '../payments/payments.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { AuditService } from '../common/audit/audit.service';
import { ModerationModule } from '../moderation/moderation.module';

@Module({
  imports: [
    PaymentsModule,
    NotificationsModule,
    SettingsModule,
    ModerationModule,
  ],
  controllers: [ProductsController, OrdersController],
  providers: [ProductsService, OrdersService, AuditService],
  exports: [OrdersService],
})
export class MarketplaceModule {}
