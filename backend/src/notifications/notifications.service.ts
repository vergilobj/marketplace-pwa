import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly appId: string;
  private readonly apiKey: string;
  private readonly baseUrl = 'https://onesignal.com/api/v1';

  constructor(private configService: ConfigService) {
    this.appId = this.configService.getOrThrow<string>('ONESIGNAL_APP_ID');
    this.apiKey = this.configService.getOrThrow<string>('ONESIGNAL_REST_API_KEY');
  }

  /**
   * Отправить уведомление всем подписанным пользователям
   */
  async sendToAll(headings: Record<string, string>, contents: Record<string, string>, data?: any) {
    const body = {
      app_id: this.appId,
      included_segments: ['All'],
      headings,
      contents,
      data,
    };
    return this.sendNotification(body);
  }

  /**
   * Отправить уведомление конкретному пользователю по external_id (наш userId)
   */
  async sendToUser(userId: string, headings: Record<string, string>, contents: Record<string, string>, data?: any) {
    const body = {
      app_id: this.appId,
      include_external_user_ids: [userId],
      headings,
      contents,
      data,
    };
    return this.sendNotification(body);
  }

  private async sendNotification(body: any) {
    try {
      const response = await fetch(`${this.baseUrl}/notifications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      const result = await response.json();
      if (!response.ok) {
        this.logger.error(`OneSignal error: ${JSON.stringify(result)}`);
      } else {
        this.logger.log(`Notification sent: ${result.id}`);
      }
      return result;
    } catch (error) {
      this.logger.error('Failed to send notification', error);
      throw error;
    }
  }
}