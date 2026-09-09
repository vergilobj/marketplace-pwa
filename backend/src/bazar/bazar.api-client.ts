import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
  payload?: Record<string, any>;
}

export interface BazarResponse {
  text: string;
  refs?: BazarRef[];
  action?: BazarAction;
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

    const data: any = await res.json().catch(() => null);
    const content = data?.choices?.[0]?.message?.content ?? '';
    return this.parseContent(content);
  }

  /** Из текста ответа достаём ```refs и ```action JSON-блоки. */
  private parseContent(content: string): BazarResponse {
    const refsM = content.match(/```refs\n([\s\S]*?)```/);
    const actionM = content.match(/```action\n([\s\S]*?)```/);

    let text = content;
    if (refsM) text = text.replace(/```refs\n[\s\S]*?```/g, '');
    if (actionM) text = text.replace(/```action\n[\s\S]*?```/g, '');
    text = text.trim();

    const out: BazarResponse = { text };

    if (refsM) {
      try {
        const refs = JSON.parse(refsM[1]);
        out.refs = Array.isArray(refs) ? refs : [];
      } catch {
        /* broken refs — ignore */
      }
    }

    if (actionM) {
      try {
        const action = JSON.parse(actionM[1]);
        if (action && typeof action === 'object' && action.intent) {
          out.action = action;
        }
      } catch {
        /* broken action — ignore */
      }
    }

    return out;
  }
}