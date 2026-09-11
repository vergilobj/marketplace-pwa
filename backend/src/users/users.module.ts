import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { AuditService } from '../common/audit/audit.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { PaymodService } from '../payments/paymod.service';
import { LedgerService } from '../payments/ledger.service';

/**
 * PaymodService и LedgerService подключаются напрямую (а не через
 * PaymentsModule), чтобы не создать цикл: PaymentsModule импортирует
 * AuthModule → UsersModule. Оба сервиса зависят только от глобального
 * PrismaService, поэтому отдельные инстансы здесь безопасны.
 */
@Module({
  imports: [
    NotificationsModule,
    SettingsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_SECRET'),
        signOptions: { expiresIn: '15m' },
      }),
    }),
  ],
  controllers: [UsersController],
  providers: [UsersService, AuditService, PaymodService, LedgerService],
  exports: [UsersService],
})
export class UsersModule {}