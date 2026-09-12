import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { PaymodService } from './paymod.service';

/**
 * G2 — конфигурация деплоя.
 *
 * Три блокера, которые эти тесты фиксируют как регрессию:
 *   1. `PAYMOD_SIDECAR_URL` не задан в backend/.env → код падал на дефолт
 *      `http://127.0.0.1:8100`, а на REG.RU нужен `:18100` (ECONNREFUSED,
 *      DEPLOY.md §5.2 — «самая частая ошибка при деплое»).
 *   2. Не было `backend/.env.production.example` — прод-окружение бэкенда
 *      нечем было поднять с нуля.
 *   3. `.env.production` не был в .gitignore.
 */
describe('G2: конфигурация деплоя', () => {
  const BACKEND = join(__dirname, '..', '..');
  const REPO_ROOT = join(BACKEND, '..');

  const readEnvKeys = (file: string): string[] => {
    const raw = readFileSync(file, 'utf-8');
    const keys: string[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      keys.push(trimmed.slice(0, eq).trim());
    }
    return keys;
  };

  // ======================= ФИКС 3: PAYMOD_SIDECAR_URL =======================

  describe('PAYMOD_SIDECAR_URL', () => {
    it('читается из ConfigService, а не только дефолт', () => {
      const config = {
        getOrThrow: jest.fn(() => 'secret'),
        get: jest.fn((key: string) =>
          key === 'PAYMOD_SIDECAR_URL' ? 'http://127.0.0.1:18100' : undefined,
        ),
      } as unknown as ConfigService;

      const svc = new PaymodService(config);
      // Приватное поле baseUrl — читаем через any, чтобы зафиксировать,
      // что env реально доезжает до клиента.
      expect((svc as any).baseUrl).toBe('http://127.0.0.1:18100');
    });

    it('дефолт 127.0.0.1:8100 работает, если env не задан', () => {
      const config = {
        getOrThrow: jest.fn(() => 'secret'),
        get: jest.fn(() => undefined),
      } as unknown as ConfigService;

      const svc = new PaymodService(config);
      expect((svc as any).baseUrl).toBe('http://127.0.0.1:8100');
    });

    it('backend/.env содержит PAYMOD_SIDECAR_URL (локально :8100)', () => {
      const envPath = join(BACKEND, '.env');
      expect(existsSync(envPath)).toBe(true);

      const keys = readEnvKeys(envPath);
      expect(keys).toContain('PAYMOD_SIDECAR_URL');

      const raw = readFileSync(envPath, 'utf-8');
      const line = raw
        .split('\n')
        .find((l) => l.trim().startsWith('PAYMOD_SIDECAR_URL='));
      expect(line).toBeDefined();
      // Локально — прямой порт сайдкара, а не туннельный.
      expect(line).toContain('8100');
      expect(line).not.toContain('18100');
    });

    it('в коде НЕТ других захардкоженных 127.0.0.1:8100, кроме дефолта', () => {
      // Единственное допустимое место — дефолт в paymod.service.ts.
      const src = readFileSync(
        join(BACKEND, 'src', 'payments', 'paymod.service.ts'),
        'utf-8',
      );
      const matches = src.match(/127\.0\.0\.1:8100/g) ?? [];
      expect(matches).toHaveLength(1);
    });
  });

  // ================= ФИКС 2: backend/.env.production.example =================

  describe('.env.production.example', () => {
    const EXAMPLE = join(BACKEND, '.env.production.example');

    it('файл существует', () => {
      expect(existsSync(EXAMPLE)).toBe(true);
    });

    it('содержит ВСЕ ключи, которые читает бэкенд', () => {
      const exampleKeys = new Set(readEnvKeys(EXAMPLE));

      // Ключи, читаемые кодом (ConfigService + process.env) — сверено
      // grep-ом, см. DEPLOY.md §4.1 и отчёт G2.
      const required = [
        // runtime
        'NODE_ENV',
        'PORT',
        'CORS_ORIGIN',
        // БД / очереди
        'DATABASE_URL',
        'REDIS_URL',
        // JWT
        'JWT_ACCESS_SECRET',
        'JWT_REFRESH_SECRET',
        // paymod
        'PAYMOD_SIDECAR_URL',
        'PAYMOD_SHARED_SECRET',
        // bazar (нейро-слой)
        'BAZAR_API_URL',
        'BAZAR_API_KEY',
        'BAZAR_MODEL',
        'BAZAR_DEAL_TIMEOUT_DAYS',
        'BAZAR_ACCEPTED_TIMEOUT_HOURS',
        // загрузки
        'UPLOAD_BASE_URL',
        // OneSignal
        'ONESIGNAL_APP_ID',
        'ONESIGNAL_REST_API_KEY',
        // nowpayments
        'NOWPAYMENTS_API_KEY',
        'NOWPAYMENTS_IPN_SECRET',
        'NOWPAYMENTS_IPN_URL',
        'NOWPAYMENTS_SANDBOX',
        // cometchat
        'COMETCHAT_APP_ID',
        'COMETCHAT_REGION',
        'COMETCHAT_REST_API_KEY',
        // G2: канал алертов
        'ALERT_WEBHOOK_URL',
      ];

      const missing = required.filter((k) => !exampleKeys.has(k));
      expect(missing).toEqual([]);
    });

    it('НЕ содержит реальных секретов — только плейсхолдеры', () => {
      const raw = readFileSync(EXAMPLE, 'utf-8');

      // Плейсхолдеры в угловых скобках, пустые значения — ок.
      const values = raw
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
        .map((l) => l.slice(l.indexOf('=') + 1))
        .filter((v) => v.length > 0);

      for (const value of values) {
        const isPlaceholder =
          value.startsWith('<') ||
          value === 'bazar' ||
          value === 'production' ||
          value === 'false' ||
          value === 'true' ||
          /^\d+$/.test(value) ||
          value.startsWith('http://127.0.0.1:') ||
          value.startsWith('https://<') ||
          value.startsWith('postgresql://<') ||
          value.startsWith('redis://127.0.0.1:');
        expect({ value, isPlaceholder }).toEqual({
          value,
          isPlaceholder: true,
        });
      }

      // Реальный прод-URL и пароли в шаблоне недопустимы. Смотрим только
      // ЗНАЧЕНИЯ (строки вне комментариев) — в комментариях формат
      // `postgresql://USER:PASSWORD@HOST` описан намеренно, это не секрет.
      const valueLines = raw
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'));

      expect(raw).not.toMatch(/xn--80aabz0c/);
      for (const line of valueLines) {
        const value = line.slice(line.indexOf('=') + 1);
        // Пароль в URL значения — только плейсхолдер в угловых скобках.
        expect(value).not.toMatch(/[^<]@[^>]*$/);
      }
    });

    it('документирует разные порты сайдкара: Hetzner 8100 / REG.RU 18100', () => {
      const raw = readFileSync(EXAMPLE, 'utf-8');
      expect(raw).toContain('8100');
      expect(raw).toContain('18100');
    });

    it('документирует, где взять OneSignal App ID', () => {
      const raw = readFileSync(EXAMPLE, 'utf-8');
      expect(raw).toContain('OneSignal');
      expect(raw).toContain('Settings');
    });
  });

  // ======================= ФИКС 2: .gitignore ==============================

  describe('.gitignore', () => {
    const GITIGNORE = join(REPO_ROOT, '.gitignore');

    it('игнорирует .env.production', () => {
      const raw = readFileSync(GITIGNORE, 'utf-8');
      const lines = raw
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'));
      expect(lines).toContain('.env.production');
    });

    it('НЕ игнорирует .env.production.example (шаблон должен коммититься)', () => {
      const raw = readFileSync(GITIGNORE, 'utf-8');
      const lines = raw
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'));
      const negations = lines.filter((l) => l.startsWith('!'));
      expect(negations.some((l) => l.includes('.env.production.example'))).toBe(
        true,
      );
    });
  });
});
