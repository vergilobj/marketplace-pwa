import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class CometChatService {
  private readonly logger = new Logger(CometChatService.name);
  private readonly appId: string;
  private readonly region: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(private configService: ConfigService) {
    this.appId = this.configService.getOrThrow<string>('COMETCHAT_APP_ID');
    this.region = this.configService.getOrThrow<string>('COMETCHAT_REGION');
    this.apiKey = this.configService.getOrThrow<string>('COMETCHAT_REST_API_KEY');
    this.baseUrl = `https://${this.appId}.api-${this.region}.cometchat.io/v3`;
  }

  async createUser(uid: string, name: string) {
    try {
      const response = await fetch(`${this.baseUrl}/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.apiKey,
        },
        body: JSON.stringify({ uid, name }),
      });
      const data = await response.json();
      this.logger.log(`CometChat user created: ${uid}`);
      return data;
    } catch (error) {
      this.logger.error(`Failed to create CometChat user ${uid}`, error);
    }
  }
}