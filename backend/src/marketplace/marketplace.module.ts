import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PaymentsModule } from '../payments/payments.module';
import { NotificationsModule } from '../notifications/notifications.module'; // <-- добавлено

@Module({
  imports: [PaymentsModule, NotificationsModule], // <-- добавлен NotificationsModule
  controllers: [ProductsController, OrdersController],
  providers: [ProductsService, OrdersService],
})
export class MarketplaceModule {}
