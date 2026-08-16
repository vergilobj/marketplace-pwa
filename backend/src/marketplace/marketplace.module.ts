import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PaymentsModule } from '../payments/payments.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditService } from '../common/audit/audit.service';

@Module({
  imports: [PaymentsModule, NotificationsModule],
  controllers: [ProductsController, OrdersController],
  providers: [ProductsService, OrdersService, AuditService],
})
export class MarketplaceModule {}
