import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule, JwtModule.register({})],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway],
})
export class ChatModule {}
