import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Уровень алерта. `error` — деньги/целостность (нужна реакция дежурного),
 * `warning` — аномалия без потери средств.
 */
export type AlertSeverity = 'error' | 'warning';

/** Тело алерта, уходящего во внешний канал. */
export interface AlertPayload {
  /** Машинный код: `money_invariants`, `underpaid`, `withdrawal_ledger_...`. */
  code: string;
  /** Текст для человека (то же, что уходит в logger.error). */
  message: string;
  /** Контекст: orderId, txHash, requestId — что поможет разбору. */
  context?: Record<string, unknown>;
  /** По умолчанию `error`. */
  severity?: AlertSeverity;
}

/** Тело POST-запроса во внешний webhook. */
export interface AlertWebhookBody {
  source: string;
  severity: AlertSeverity;
  code: string;
  message: string;
  context: Record<string, unknown>;
  timestamp: string;
}

/**
 * Канал внешних алертов (G2, фикс 4).
 *
 * ЗАЧЕМ. Раньше алерт = `logger.error('ALERT ...')` + запись `Notification`
 * каждому ADMIN в БД. Оба адресата «пассивные»: если админ не читает логи и не
 * залогинился в /notifications — алерт утонул. Для денежных инвариантов
 * (`ledger.runInvariantCheck` раз в 10 минут) это означает, что о потерянных
 * средствах можно узнать через дни.
 *
 * ЧТО ДЕЛАЕТ. Один HTTP POST на URL из `ALERT_WEBHOOK_URL`. Выбран webhook, а
 * не Telegram-бот, потому что:
 *   - нет зависимости от внешнего API и его лимитов;
 *   - не нужен ещё один секрет (bot token) в прод-окружении;
 *   - принимающая сторона любая: Slack/Discord/n8n/self-hosted эндпоинт;
 *   - проверяется локальным мок-сервером на 127.0.0.1 без сети наружу.
 *
 * ГАРАНТИИ (важно):
 *   - при незаданном `ALERT_WEBHOOK_URL` — ТИХИЙ fallback: debug-лог и выход.
 *     Никакой сети, никаких исключений, текущее поведение (лог + БД) intact.
 *   - `send()` НИКОГДА не бросает. Канал алертов не имеет права уронить
 *     платёжный поток: недоступный webhook — это `logger.error` и `false`.
 *   - таймаут запроса, чтобы недоступный хост не подвешивал cron/HTTP-хендлер.
 *   - ДЕДУП: `ledger.runInvariantCheck` крутится раз в 10 минут. Пока проблема
 *     не устранена, она детектится на каждом прогоне — без дедупа внешний
 *     канал получал бы один и тот же алерт 144 раза в сутки и его бы
 *     замутили. Одинаковые (code + message) подавляются в окне
 *     `ALERT_DEDUP_MINUTES` (по умолчанию 60, `0` — выключить).
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);
  private readonly webhookUrl?: string;
  private readonly source = 'marketplace-backend';
  private readonly timeoutMs = 5000;
  private readonly dedupMs: number;

  /** key = `${code}::${message}` → timestamp последней отправки (мс). */
  private readonly recentlySent = new Map<string, number>();

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('ALERT_WEBHOOK_URL');
    this.webhookUrl = url?.trim() ? url.trim() : undefined;

    const rawDedup = this.config.get<string>('ALERT_DEDUP_MINUTES');
    const parsedDedup = parseInt(rawDedup ?? '', 10);
    const dedupMinutes = Number.isFinite(parsedDedup)
      ? Math.max(0, parsedDedup)
      : 60;
    this.dedupMs = dedupMinutes * 60 * 1000;

    if (this.webhookUrl) {
      // URL может содержать токен в пути — в лог печатаем только хост.
      this.logger.log(
        `Внешний канал алертов включён: ${AlertsService.redact(this.webhookUrl)}`,
      );
    } else {
      this.logger.log(
        'ALERT_WEBHOOK_URL не задан — внешний канал алертов выключен, ' +
          'алерты остаются в логе и в /notifications (fallback)',
      );
    }
  }

  /** Настроен ли внешний канал. `false` → алерты только в лог/БД. */
  get enabled(): boolean {
    return Boolean(this.webhookUrl);
  }

  /**
   * Отправить алерт во внешний канал.
   *
   * @returns `true` если webhook принял (2xx), иначе `false`. Не бросает.
   */
  async send(alert: AlertPayload): Promise<boolean> {
    if (!this.webhookUrl) {
      // Тихий fallback: вызывающий код уже записал logger.error + Notification.
      this.logger.debug(
        `Алерт без внешнего канала [${alert.code}]: ${alert.message}`,
      );
      return false;
    }

    const body: AlertWebhookBody = {
      source: this.source,
      severity: alert.severity ?? 'error',
      code: alert.code,
      message: alert.message,
      context: alert.context ?? {},
      timestamp: new Date().toISOString(),
    };

    // Дедуп: cron инвариантов повторяет тот же текст каждые 10 минут.
    const dedupKey = `${body.code}::${body.message}`;
    if (this.isDuplicate(dedupKey)) {
      this.logger.debug(`Алерт подавлен дедупом [${body.code}]`);
      return false;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        this.logger.error(
          `ALERT webhook rejected: HTTP ${response.status} (code=${alert.code})`,
        );
        return false;
      }
      return true;
    } catch (err) {
      // Никогда не пробрасываем: недоставленный алерт не должен ломать
      // платёжную операцию, в которой он возник.
      this.logger.error(
        `ALERT webhook delivery failed (code=${alert.code}): ${
          (err as Error).message
        }`,
      );
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * true — такой же алерт уже уходил в пределах окна дедупа.
   * Заодно подчищает протухшие ключи, чтобы Map не рос бесконечно.
   */
  private isDuplicate(key: string): boolean {
    if (this.dedupMs <= 0) return false;

    const now = Date.now();
    for (const [k, ts] of this.recentlySent) {
      if (now - ts >= this.dedupMs) this.recentlySent.delete(k);
    }

    const last = this.recentlySent.get(key);
    if (last !== undefined && now - last < this.dedupMs) return true;

    this.recentlySent.set(key, now);
    return false;
  }

  /** Убрать из URL всё, что похоже на секрет (query/token в пути). */
  private static redact(url: string): string {
    try {
      const parsed = new URL(url);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return '<invalid URL>';
    }
  }
}