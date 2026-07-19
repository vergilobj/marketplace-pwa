import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { ChatService } from './chat.service';
import { CometChatMessageDto } from './dto/webhook.dto';

@Controller('chat')
export class ChatController {
  constructor(
    private chatService: ChatService,
    private config: ConfigService,
  ) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() body: CometChatMessageDto,
    @Headers('x-cometchat-signature') signature: string,
  ) {
    const secret = this.config.get<string>('COMETCHAT_WEBHOOK_SECRET');
    if (!secret)
      throw new UnauthorizedException('Webhook secret not configured');
    if (!signature)
      throw new UnauthorizedException('Missing webhook signature');
    const expected = createHmac('sha256', secret)
      .update(JSON.stringify(body))
      .digest('hex');
    if (signature !== expected)
      throw new UnauthorizedException('Invalid webhook signature');
    return this.chatService.moderateMessage(body);
  }
}
