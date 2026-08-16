import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private onlineUserIds = new Set<string>();

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

  /**
   * Серверная модерация текста.
   * Возвращает { blocked: true, reason: 'stop_word' | 'contact' } при нарушении.
   */
  async moderate(text: string): Promise<{ blocked: boolean; reason?: string }> {
    const { stopWords } = await this.getModerationRules();
    const lower = text.toLowerCase();

    for (const word of stopWords) {
      if (word && lower.includes(word.toLowerCase())) {
        return { blocked: true, reason: 'stop_word' };
      }
    }

    if (this.detectContact(text)) {
      return { blocked: true, reason: 'contact' };
    }

    return { blocked: false };
  }

  private detectContact(text: string): boolean {
    // Телефоны: +7..., 8..., просто 10+ цифр подряд
    const phoneRegex = /(\+?\d[\d\s()\-]{9,}\d)/;
    // Email
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    // URL
    const urlRegex =
      /(https?:\/\/|www\.)[^\s]+|(^|\s)([\w-]+\.)+(ru|com|net|org|io|me|xyz|top|site|online)(\/[^\s]*)?/i;

    if (phoneRegex.test(text)) return true;
    if (emailRegex.test(text)) return true;
    if (urlRegex.test(text)) return true;
    return false;
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

  // ====== Онлайн-статус ======
  setOnline(userId: string, online: boolean) {
    if (online) {
      this.onlineUserIds.add(userId);
    } else {
      this.onlineUserIds.delete(userId);
    }
  }

  getOnlineStatus(userId: string): boolean {
    return this.onlineUserIds.has(userId);
  }
}