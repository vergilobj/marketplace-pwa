import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ModerationInput {
  text: string;
  entityType:
    | 'p2p_chat'
    | 'deal_relay'
    | 'post'
    | 'ad'
    | 'comment'
    | 'product'
    | 'deal_message';
  entityId?: string;
  userId?: string;
}

export interface ModerationVerdict {
  verdict: 'allow' | 'block' | 'warn';
  reason: string;
  violations: string[]; // phone | email | external_link | off_platform | spam | insult
  context_id?: string;
}

const LLM_MAX_CHARS = 1000;
const LLM_TIMEOUT_MS = 15000;

/**
 * Минимальный единый контракт модерации (SPEC §8).
 * Э1: детерминированный regExp-fallback (дёшево, дётерминированно).
 * Э2: LLM-модерация через Hermes API Server (профиль `bazar`).
 * При недоступности ИИ — не блокируем (regExp уже прошёл).
 */
@Injectable()
export class ModerationService {
  private readonly logger = new Logger(ModerationService.name);

  private readonly apiUrl: string;
  private readonly apiKey: string;

  constructor(private readonly config: ConfigService) {
    this.apiUrl =
      this.config.get<string>('BAZAR_API_URL') || 'http://127.0.0.1:8642/v1';
    this.apiKey = this.config.get<string>('BAZAR_API_KEY') || '';
  }

  // Телефон: +7..., 8..., международные форматы
  private readonly phoneRe =
    /(?:\+?\d[\d\s\-()]{6,}\d|(?:\+7|8)[\s\-]?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2})/;

  // Email
  private readonly emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

  // Внешние ссылки (в т.ч. обфусцированные пробелами/точками)
  private readonly urlRe =
    /(?:https?:\/\/|www\.|t\.me\/|vk\.com\/|wa\.me\/|instagram\.com\/|whatsapp\.)/i;

  // Маркеры мессенджеров/соцсетей сами по себе — попытка увода с площадки
  private readonly offPlatformRe =
    /(?:вацап|вацапп|ватсап|вотсап|во?тсап|whatsapp|телеграм|телега|телег|telegram|t\.me|vk\.com|(?<![а-яёa-z0-9])вк(?![а-яёa-z0-9])|(?<![а-яёa-z0-9])тг(?![а-яёa-z0-9])|\btg\b|instagram|инстаграм|инста|инст|созвон|созвонимся|позвони|позвоните|мой номер|свой номер|скинь номер|дай номер|мой контакт|дай контакт|свой контакт)/i;

  async moderate(input: ModerationInput): Promise<ModerationVerdict> {
    const violations: string[] = [];
    const text = input.text || '';

    if (this.phoneRe.test(text)) violations.push('phone');
    if (this.emailRe.test(text)) violations.push('email');
    if (this.urlRe.test(text)) violations.push('external_link');
    if (this.offPlatformRe.test(text)) violations.push('off_platform');

    if (violations.length > 0) {
      const reason = this.reasonFor(violations);
      this.logger.warn(
        `Moderation block (${input.entityType}): ${violations.join(',')} — ${reason}`,
      );
      return { verdict: 'block', reason, violations };
    }

    // regExp пропустил → LLM-проверка.
    return this.moderateWithLlm(text);
  }

  private async moderateWithLlm(text: string): Promise<ModerationVerdict> {
    const trimmed = text.slice(0, LLM_MAX_CHARS);

    const prompt =
      'Ты — модератор площадки. Проверь текст на нарушения. Ответь СТРОГО JSON без пояснений: ' +
      '{"verdict":"allow"|"block"|"warn","reason":"...","violations":["spam"|"insult"|"off_platform"|"contact_sharing"]}. ' +
      `Текст: ${trimmed}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

    try {
      const res = await fetch(`${this.apiUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          'X-Hermes-Session-Key': 'moderation',
        },
        body: JSON.stringify({
          model: this.config.get<string>('BAZAR_MODEL') || 'bazar',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
          stream: false,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        this.logger.warn(`LLM moderation HTTP ${res.status}, fallback allow`);
        return { verdict: 'allow', reason: '', violations: [] };
      }

      const data: any = await res.json().catch(() => null);
      const content: string = data?.choices?.[0]?.message?.content ?? '';
      const parsed = this.parseLlmJson(content);
      if (!parsed) return { verdict: 'allow', reason: '', violations: [] };

      return {
        verdict: parsed.verdict,
        reason: parsed.reason || '',
        violations: Array.isArray(parsed.violations) ? parsed.violations : [],
      };
    } catch (e) {
      this.logger.warn(
        `LLM moderation unavailable (${(e as Error).name}): fallback allow`,
      );
      return { verdict: 'allow', reason: '', violations: [] };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Достаём JSON из ответа модели (устойчиво к markdown-обёртке). */
  private parseLlmJson(content: string): {
    verdict: 'allow' | 'block' | 'warn';
    reason: string;
    violations: string[];
  } | null {
    if (!content) return null;

    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1] : content;

    try {
      const obj = JSON.parse(candidate);
      if (!obj || typeof obj !== 'object') return null;
      const verdict = obj.verdict;
      if (verdict !== 'allow' && verdict !== 'block' && verdict !== 'warn') {
        return null;
      }
      return {
        verdict,
        reason: typeof obj.reason === 'string' ? obj.reason : '',
        violations: Array.isArray(obj.violations) ? obj.violations : [],
      };
    } catch {
      // Пытаемся вырезать первый JSON-объект из текста.
      const m = content.match(/\{[\s\S]*\}/);
      if (!m) return null;
      try {
        const obj = JSON.parse(m[0]);
        if (!obj || typeof obj !== 'object') return null;
        const verdict = obj.verdict;
        if (verdict !== 'allow' && verdict !== 'block' && verdict !== 'warn') {
          return null;
        }
        return {
          verdict,
          reason: typeof obj.reason === 'string' ? obj.reason : '',
          violations: Array.isArray(obj.violations) ? obj.violations : [],
        };
      } catch {
        return null;
      }
    }
  }

  private reasonFor(violations: string[]): string {
    if (violations.includes('phone')) return 'передавать телефон напрямую нельзя — площадка защищает контакты';
    if (violations.includes('email')) return 'передавать email напрямую нельзя';
    if (violations.includes('external_link')) return 'внешние ссылки в чате запрещены';
    if (violations.includes('off_platform')) return 'уводить общение с площадки запрещено';
    return 'сообщение не прошло модерацию';
  }
}