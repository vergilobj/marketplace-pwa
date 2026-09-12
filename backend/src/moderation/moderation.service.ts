import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma/prisma.service';

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

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.apiUrl =
      this.config.get<string>('BAZAR_API_URL') || 'http://127.0.0.1:8642/v1';
    this.apiKey = this.config.get<string>('BAZAR_API_KEY') || '';
  }

  // Телефон: только РЕАЛЬНЫЕ телефонные структуры, НЕ произвольные длинные числа.
  //
  // B2-фикс: старая левая альтернатива `\+?\d[\d\s\-()]{6,}\d` ловила любые ≥8 цифр
  // подряд (артикул «1234567890», серийник «861234567890123», «1 234 567 890»).
  // Теперь:
  //   1) `+7`/`8` + ровно 10 цифр (с опциональными разделителями) — 89123456789,
  //      +79123456789, «8 (912) 345-67-89», «+7 912 345 67 89»;
  //   2) 10-значный номер с телефонной структурой 3-3-4 или 3-3-2-2 (нужны
  //      разделители — «1234567890» без них не ловится).
  // Границы `(?<!\d)`/`(?!\d)` не дают совпасть куску длинного числа:
  // «861234567890123» (15 цифр) и «1 234 567 890» остаются артикулами.
  private readonly phoneRe =
    /(?<!\d)(?:(?:\+7|8)[\s\-]?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}|\d{3}[\s\-]\d{3}[\s\-]\d{4}|\d{3}[\s\-]\d{3}[\s\-]\d{2}[\s\-]\d{2})(?!\d)/;

  // Email
  private readonly emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

  // Внешние ссылки (в т.ч. обфусцированные пробелами/точками)
  private readonly urlRe =
    /(?:https?:\/\/|www\.|t\.me\/|vk\.com\/|wa\.me\/|instagram\.com\/|whatsapp\.)/i;

  // Ссылка без протокола: «youtube.com/watch?v=x», «disk.yandex.ru/x».
  // Расширения файлов (photo.jpg, video.mp4) доменом не считаем.
  private readonly bareDomainRe =
    /(?<![\w@.-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s]*)?/gi;

  private readonly fileExtRe =
    /\.(?:jpe?g|png|gif|webp|avif|bmp|svg|mp4|webm|mov|avi|mkv|mp3|wav|ogg|pdf|docx?|xlsx?|pptx?|zip|rar|7z|txt|csv|json)$/i;

  // Внутренние ссылки площадки — загруженные файлы и API. Внешними не считаются:
  // это единственный разрешённый тип ссылок для обычного пользователя.
  private readonly internalLinkRe =
    /^(?:https?:\/\/[^/\s]+)?\/?(?:uploads|api\/upload)\//i;

  // Ссылки, вырезаемые из текста перед проверкой увода с площадки.
  private readonly linkStripRe =
    /(?<![\w@.-])(?:https?:\/\/|www\.)\S+|(?<![\w@.-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s]*)?/gi;

  /**
   * Роли, которым разрешено выставлять любые ссылки (A5.6).
   *
   * В схеме НЕТ флага `isPartner` / `isTrusted` (User), поэтому «партнёр, кому
   * доверяют админы» выражается существующей ролью MODERATOR — она и есть
   * доверенный уровень между BUYER/SELLER и ADMIN.
   */
  private static readonly TRUSTED_ROLES: readonly string[] = ['ADMIN', 'MODERATOR'];

  /** Доверенная роль → любые ссылки разрешены. */
  private isTrustedRole(role?: string | null): boolean {
    return !!role && ModerationService.TRUSTED_ROLES.includes(role);
  }

  /**
   * Вырезает ЛЮБЫЕ ссылки из текста. Нужно, чтобы сам факт ссылки не считался
   * уводом с площадки (для доверенных ролей), а призывы «пиши в телегу» и
   * обмен телефонами по-прежнему ловились.
   */
  private stripLinks(text: string): string {
    return text.replace(this.linkStripRe, ' ');
  }

  /** Есть ли в тексте внешняя (не внутренняя) ссылка. */
  private hasExternalLink(text: string): boolean {
    const collect = (re: RegExp): string[] => {
      const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
      const rx = new RegExp(re.source, flags);
      const out: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = rx.exec(text)) !== null) out.push(m[0]);
      return out;
    };

    const candidates = [...collect(this.urlRe), ...collect(this.bareDomainRe)];
    return candidates.some((raw) => {
      const link = raw.trim();
      if (!link) return false;
      if (this.internalLinkRe.test(link)) return false; // /uploads/* — своё
      if (this.fileExtRe.test(link.split(/[?#]/)[0])) return false; // имя файла
      return true;
    });
  }

  // Маркеры мессенджеров/соцсетей сами по себе — попытка увода с площадки
  private readonly offPlatformRe =
    /(?:вацап|вацапп|ватсап|вотсап|во?тсап|whatsapp|телеграм|телега|телег|telegram|t\.me|vk\.com|(?<![а-яёa-z0-9])вк(?![а-яёa-z0-9])|(?<![а-яёa-z0-9])тг(?![а-яёa-z0-9])|\btg\b|instagram|инстаграм|инста|инст|созвон|созвонимся|позвони|позвоните|мой номер|свой номер|скинь номер|дай номер|мой контакт|дай контакт|свой контакт)/i;

  async moderate(input: ModerationInput): Promise<ModerationVerdict> {
    const violations: string[] = [];
    const text = input.text || '';

    // A5.6: ссылки выставляют только доверенные роли (ADMIN и партнёры=MODERATOR).
    // ADMIN/партнёр обходят модерацию полностью. Обычный юзер (BUYER/SELLER)
    // ссылок не ставит вообще — кроме внутренних /uploads/* (загруженный файл).
    if (input.userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: input.userId },
        select: { role: true },
      });
      if (this.isTrustedRole(user?.role)) {
        return { verdict: 'allow', reason: '', violations: [] };
      }
    }

    if (this.phoneRe.test(text)) violations.push('phone');
    if (this.emailRe.test(text)) violations.push('email');

    // Ссылки обычного пользователя: запрещены ЛЮБЫЕ внешние, whitelist
    // видеохостингов убран (A5.5) — видео живёт только через загрузку файла
    // (внутренняя /uploads/videos/*), а не ссылкой на хостинг.
    if (this.hasExternalLink(text)) {
      violations.push('external_link');
    }

    // Увод с площадки проверяем на тексте БЕЗ ссылок: сам факт ссылки уже
    // наказан выше, а призывы «пиши в телегу» и обмен контактами должны
    // ловиться независимо от того, приложена ссылка или нет.
    const offPlatformProbe = this.stripLinks(text);
    if (this.offPlatformRe.test(offPlatformProbe)) {
      violations.push('off_platform');
    }

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
    // Ссылки уже провалидированы regExp-слоем выше (у обычного юзера внешних
    // ссылок быть не может — иначе он бы сюда не дошёл). Модель склонна
    // флагать остатки URL как off_platform, поэтому вырезаем ссылки из текста
    // перед отправкой — LLM судит только остаток (контакты, призывы).
    const stripped = this.stripLinks(text).replace(/\s+/g, ' ').trim();
    const trimmed = stripped.slice(0, LLM_MAX_CHARS);

    // После вырезания ссылок модерировать нечего — regExp уже пропустил.
    if (!trimmed) {
      return { verdict: 'allow', reason: '', violations: [] };
    }

    const prompt =
      'Ты — модератор площадки. Проверь текст на нарушения. Ответь СТРОГО JSON без пояснений: ' +
      '{"verdict":"allow"|"block"|"warn","reason":"...","violations":["spam"|"insult"|"off_platform"|"contact_sharing"]}. ' +
      'ВАЖНО: ссылки вырезаны из текста ДО тебя — их отсутствие нормально, не выдумывай нарушение по этому поводу. ' +
      'Блокируй (off_platform) только: призывы уйти в мессенджер, обмен телефоном/email, попытку созвона. ' +
      'Ссылки на домены в тексте (если остались) — нарушение external_link. ' +
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

      const data = (await res.json().catch(() => null)) as {
        choices?: { message?: { content?: string } }[];
      } | null;
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