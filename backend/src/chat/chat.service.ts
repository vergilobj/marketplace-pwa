import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { CometChatMessageDto } from './dto/webhook.dto';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  constructor(
    private prisma: PrismaService,
    private settingsService: SettingsService,
  ) {}

  async moderateMessage(message: CometChatMessageDto) {
    // Получить стоп-слова из настроек
    const stopWordsSetting = await this.settingsService.get('stop_words');
    const stopWords: string[] = stopWordsSetting ? JSON.parse(stopWordsSetting) : [];

    // Проверка контактов и стоп-слов
    const contactRegex = /(?:\+?\d{10,})|(?:[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})|(?:https?:\/\/\S+)/gi;
    const hasContact = contactRegex.test(message.text);
    const hasStopWord = stopWords.some((word: string) =>
      message.text.toLowerCase().includes(word.toLowerCase()),
    );

    if (hasContact || hasStopWord) {
      const reason = hasContact ? 'Contact info detected' : 'Stop word detected';
      await this.prisma.moderationLog.create({
        data: {
          chatMsgId: message.id,
          reason,
          action: 'hidden',
        },
      });
      this.logger.warn(`Message ${message.id} hidden: ${reason}`);
      return { action: 'hidden', reason };
    }

    return { action: 'allowed' };
  }
}