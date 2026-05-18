import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  controllers: [ProductsController, OrdersController],
  providers: [ProductsService, OrdersService],
  imports: [PaymentsModule],
  
})
export class MarketplaceModule {}