import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  constructor(
    private prisma: PrismaService,
    private settingsService: SettingsService,
  ) {}

  async setPublicKey(userId: string, publicKey: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { chatPublicKey: publicKey },
    });
  }

  async getPublicKey(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { chatPublicKey: true },
    });
    return user?.chatPublicKey ?? null;
  }

  async getModerationRules() {
    const stopWordsSetting = await this.settingsService.get('stop_words');
    const stopWords: string[] = stopWordsSetting
      ? JSON.parse(stopWordsSetting)
      : [];
    return { stopWords, detectContacts: true };
  }

  async reportMessage(userId: string, messageId: string, reason?: string) {
    return this.prisma.moderationLog.create({
      data: {
        chatMsgId: messageId,
        reason: reason || '',
        action: 'reported',
      },
    });
  }
}
