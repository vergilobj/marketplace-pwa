import { Module } from '@nestjs/common';
import { CometChatService } from './cometchat.service';

@Module({
  providers: [CometChatService],
  exports: [CometChatService],
})
export class CometChatModule {}