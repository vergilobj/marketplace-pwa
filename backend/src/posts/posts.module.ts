import { Module } from '@nestjs/common';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { SettingsModule } from '../settings/settings.module';
import { PaymentsModule } from '../payments/payments.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [SettingsModule, PaymentsModule, AuthModule],
  controllers: [PostsController],
  providers: [PostsService],
})
export class PostsModule {}