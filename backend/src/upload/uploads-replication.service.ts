import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import { existsSync } from 'fs';

/**
 * PD-FIX-1: репликация новых загрузок на вторую ноду.
 *
 * ПРОБЛЕМА (прод, подтверждено живьём): `uploads/` не расшарены между
 * Hetzner и REG.RU, а nginx на REG.RU гео-роутит `/uploads/` на ЛОКАЛЬНЫЙ
 * бэкенд (РФ → 127.0.0.1:3000, остальные → 127.0.0.1:13000 = Hetzner через
 * туннель). Пользователь заливает картинку → она попадает ровно на ОДНУ ноду
 * → у половины пользователей (по стране) все картинки постов и рекламы = 404.
 *
 * РЕШЕНИЕ: после того как multer сохранил файл, этот сервис best-effort
 * копирует его на вторую ноду (`uploads-sync.sh --files ...`). Существующие
 * файлы закрывает `uploads-sync.sh --once` (крон/демон на обеих нодах).
 *
 * ПОЧЕМУ ТАК, А НЕ S3/NFS: обе ноды уже ходят друг к другу по SSH-ключу
 * (autossh-туннели живы), объём uploads — десятки МБ, а переезд на S3 тянул бы
 * за собой фронт (UPLOAD_BASE_URL), multer-хранилище и миграцию 2000+ файлов.
 * При этом вариант «общий бэкенд» (nginx всегда ходит на master) отброшен: он
 * убивает смысл REG.RU-ноды — локальный бэкенд для РФ и есть причина её
 * существования.
 *
 * ГАРАНТИИ:
 *   - НИКОГДА не бросает исключение: сбой репликации не должен ломать
 *     загрузку пользователя (best-effort + лог).
 *   - НЕ трогает платежи/заказы/OneSignal.
 *   - Если `BAZAR_UPLOADS_PEER` не задан — сервис молча выключен.
 */
@Injectable()
export class UploadsReplicationService {
  private readonly logger = new Logger(UploadsReplicationService.name);
  private readonly enabled: boolean;
  private readonly scriptPath: string;

  /** Очередь относительных путей (без префикса uploads/). */
  private queue: string[] = [];
  private timer?: NodeJS.Timeout;
  private flushing = false;

  constructor(@Optional() private readonly config?: ConfigService) {
    const peer = this.config?.get<string>('BAZAR_UPLOADS_PEER') || '';
    const script =
      this.config?.get<string>('BAZAR_UPLOADS_SYNC_SCRIPT') ||
      `${process.cwd()}/scripts/uploads-sync.sh`;

    this.scriptPath = script;
    this.enabled = Boolean(peer) && existsSync(script);

    if (!this.enabled) {
      this.logger.warn(
        'PD-FIX-1: репликация uploads выключена ' +
          `(peer=${peer ? 'set' : 'empty'}, script=${existsSync(script) ? 'found' : 'missing'})`,
      );
    } else {
      this.logger.log(`PD-FIX-1: репликация uploads включена → ${peer}`);
    }
  }

  /**
   * Поставить файл в очередь на копирование.
   * @param relativePath путь ОТНОСИТЕЛЬНО папки uploads
   *        (например `a326ffab-....jpeg` или `videos/x.mp4`).
   */
  replicate(relativePath?: string): void {
    if (!this.enabled || !relativePath) return;
    this.queue.push(relativePath);

    // Склеиваем загрузки в одно окно — не спавним процесс на каждый файл.
    if (!this.timer) {
      this.timer = setTimeout(() => void this.flush(), 1500);
    }
  }

  private async flush(): Promise<void> {
    this.timer = undefined;
    if (this.flushing) return;
    this.flushing = true;

    const batch = this.queue.splice(0, this.queue.length);
    if (batch.length === 0) {
      this.flushing = false;
      return;
    }

    try {
      await this.runScript(['--files', ...batch]);
      this.logger.log(
        `PD-FIX-1: реплицировано ${batch.length} файл(ов): ${batch.join(', ')}`,
      );
    } catch (e) {
      // Best-effort: падение репликации НЕ влияет на ответ пользователю.
      this.logger.warn(
        `PD-FIX-1: репликация не удалась (${batch.join(', ')}): ${String(e)}`,
      );
    } finally {
      this.flushing = false;
      if (this.queue.length > 0 && !this.timer) {
        this.timer = setTimeout(() => void this.flush(), 1500);
      }
    }
  }

  private runScript(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.scriptPath, args, {
        stdio: 'ignore',
        detached: false,
      });
      child.on('error', reject);
      child.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`exit ${code}`)),
      );
    });
  }
}