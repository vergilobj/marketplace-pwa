import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseBazarContent } from './bazar-response.parser';

export interface BazarMessagePayload {
  role: 'user' | 'assistant';
  content: string;
}

export interface BazarRef {
  type: string;
  id: string;
  title?: string;
}

export interface BazarAction {
  intent: string;
  payload?: Record<string, unknown>;
}

export interface BazarResponse {
  text: string;
  refs?: BazarRef[];
  action?: BazarAction;
}

/** Урезанная форма OpenAI-совместимого ответа /chat/completions. */
interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
}

@Injectable()
export class BazarApiClient {
  private readonly logger = new Logger(BazarApiClient.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(private config: ConfigService) {
    this.baseUrl = this.config.get<string>('BAZAR_API_URL') || 'http://127.0.0.1:8642/v1';
    this.apiKey = this.config.get<string>('BAZAR_API_KEY') || '';
    this.model = this.config.get<string>('BAZAR_MODEL') || 'bazar';
  }

  /**
   * Полный не-стриминговый вызов (MVP).
   * Проксирует в Hermes API Server профиля `bazar`.
   * Личность Базара живёт в SOUL профиля — промпт здесь НЕ пишем.
   * X-Hermes-Session-Key изолирует юзеров по userId.
   */
  async complete(
    messages: BazarMessagePayload[],
    opts?: { temperature?: number; sessionKey?: string },
  ): Promise<BazarResponse> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          ...(opts?.sessionKey ? { 'X-Hermes-Session-Key': opts.sessionKey } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: opts?.temperature ?? 0.4,
          stream: false,
        }),
      });
    } catch (e) {
      this.logger.error(`Bazar API unreachable: ${(e as Error).message}`);
      throw new Error('bazar_unreachable');
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this.logger.error(`Bazar API error ${res.status}: ${body.slice(0, 300)}`);
      throw new Error('bazar_error');
    }

    const data = (await res.json().catch(() => null)) as ChatCompletionResponse | null;
    const content = data?.choices?.[0]?.message?.content ?? '';
    return this.parseContent(content);
  }

  /**
   * Из текста ответа достаём ```refs и ```action JSON-блоки.
   * Устойчивый разбор (B2): закрытые/незакрытые фенсы, голые маркеры, битый JSON —
   * см. bazar-response.parser.ts (зеркало фронтового parseBazarResponse).
   */
  private parseContent(content: string): BazarResponse {
    return parseBazarContent(content);
  }
}