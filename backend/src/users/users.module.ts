import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { AuditService } from '../common/audit/audit.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymodService } from '../payments/paymod.service';

@Module({
  imports: [NotificationsModule],
  controllers: [UsersController],
  providers: [UsersService, AuditService, PaymodService],
  exports: [UsersService],
})
export class UsersModule {}