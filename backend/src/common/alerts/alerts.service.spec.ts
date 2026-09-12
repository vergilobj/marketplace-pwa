import { ConfigService } from '@nestjs/config';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { AlertsService } from './alerts.service';

/**
 * G2, фикс 4 — внешний канал алертов.
 *
 * Проверяем не только happy-path, но и два обещания, которые канал даёт
 * платёжному коду:
 *   1) при незаданном ALERT_WEBHOOK_URL — тихий fallback, НИ ОДНОГО запроса
 *      в сеть и ни одного исключения;
 *   2) недоступный/падающий webhook не ломает вызывающую операцию — send()
 *      возвращает false и не бросает.
 */
describe('AlertsService', () => {
  const makeConfig = (values: Record<string, string>): ConfigService =>
    ({
      get: jest.fn((key: string) => values[key]),
    }) as unknown as ConfigService;

  describe('при незаданном ALERT_WEBHOOK_URL (тихий fallback)', () => {
    it('enabled === false', () => {
      const service = new AlertsService(makeConfig({}));
      expect(service.enabled).toBe(false);
    });

    it('send() возвращает false и НЕ ходит в сеть', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch');
      const service = new AlertsService(makeConfig({}));

      const result = await service.send({
        code: 'money_invariants_violated',
        message: 'тест',
      });

      expect(result).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it('пустая строка и пробелы считаются «не задан»', () => {
      expect(
        new AlertsService(makeConfig({ ALERT_WEBHOOK_URL: '' })).enabled,
      ).toBe(false);
      expect(
        new AlertsService(makeConfig({ ALERT_WEBHOOK_URL: '   ' })).enabled,
      ).toBe(false);
    });

    it('send() не бросает даже на пустом сообщении', async () => {
      const service = new AlertsService(makeConfig({}));
      await expect(
        service.send({ code: 'x', message: '' }),
      ).resolves.toBe(false);
    });
  });

  describe('при заданном ALERT_WEBHOOK_URL (реальная отправка)', () => {
    let server: Server;
    let baseUrl: string;
    let received: Array<{ body: any; method: string; contentType?: string }>;
    let respondStatus: number;

    beforeAll(async () => {
      received = [];
      respondStatus = 200;

      server = createServer((req, res) => {
        let raw = '';
        req.on('data', (chunk) => (raw += chunk));
        req.on('end', () => {
          received.push({
            body: raw ? JSON.parse(raw) : null,
            method: req.method ?? '',
            contentType: req.headers['content-type'],
          });
          res.statusCode = respondStatus;
          res.end('{}');
        });
      });

      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}/alerts`;
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    beforeEach(() => {
      received = [];
      respondStatus = 200;
    });

    const service = () =>
      new AlertsService(makeConfig({ ALERT_WEBHOOK_URL: baseUrl }));

    it('шлёт POST с JSON-телом на URL из env', async () => {
      const svc = service();
      expect(svc.enabled).toBe(true);

      const ok = await svc.send({
        code: 'underpaid',
        message: 'Недоплата по заказу o-1',
        context: { orderId: 'o-1' },
      });

      expect(ok).toBe(true);
      expect(received).toHaveLength(1);
      expect(received[0].method).toBe('POST');
      expect(received[0].contentType).toBe('application/json');
      expect(received[0].body).toMatchObject({
        source: 'marketplace-backend',
        severity: 'error',
        code: 'underpaid',
        message: 'Недоплата по заказу o-1',
        context: { orderId: 'o-1' },
      });
      // timestamp — ISO-8601.
      expect(received[0].body.timestamp).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      );
    });

    it('severity по умолчанию error, но можно переопределить', async () => {
      const svc = service();
      await svc.send({ code: 'a', message: 'msg-a' });
      await svc.send({ code: 'b', message: 'msg-b', severity: 'warning' });

      expect(received[0].body.severity).toBe('error');
      expect(received[1].body.severity).toBe('warning');
    });

    it('context по умолчанию — пустой объект, а не undefined', async () => {
      const svc = service();
      await svc.send({ code: 'no_ctx', message: 'без контекста' });
      expect(received[0].body.context).toEqual({});
    });

    it('не-2xx ответ → false (но не исключение)', async () => {
      respondStatus = 500;
      const svc = service();
      const ok = await svc.send({ code: 'boom', message: 'сервер упал' });
      expect(ok).toBe(false);
    });

    it('недоступный хост → false, без броска', async () => {
      // Порт, который никто не слушает.
      const svc = new AlertsService(
        makeConfig({ ALERT_WEBHOOK_URL: 'http://127.0.0.1:1/alerts' }),
      );
      await expect(
        svc.send({ code: 'down', message: 'хост недоступен' }),
      ).resolves.toBe(false);
    });

    describe('дедуп (cron инвариантов раз в 10 минут)', () => {
      it('одинаковые code+message подавляются в окне', async () => {
        const svc = service();

        expect(await svc.send({ code: 'dup', message: 'одно и то же' })).toBe(
          true,
        );
        expect(await svc.send({ code: 'dup', message: 'одно и то же' })).toBe(
          false,
        );
        expect(await svc.send({ code: 'dup', message: 'одно и то же' })).toBe(
          false,
        );

        // В сеть ушёл ровно один запрос — не 3.
        expect(received).toHaveLength(1);
      });

      it('разный code или message не подавляются', async () => {
        const svc = service();
        await svc.send({ code: 'a', message: 'текст' });
        await svc.send({ code: 'b', message: 'текст' });
        await svc.send({ code: 'a', message: 'другой текст' });
        expect(received).toHaveLength(3);
      });

      it('ALERT_DEDUP_MINUTES=0 выключает дедуп', async () => {
        const svc = new AlertsService(
          makeConfig({ ALERT_WEBHOOK_URL: baseUrl, ALERT_DEDUP_MINUTES: '0' }),
        );
        await svc.send({ code: 'x', message: 'y' });
        await svc.send({ code: 'x', message: 'y' });
        expect(received).toHaveLength(2);
      });

      it('окно дедупа истекает и алерт уходит снова', async () => {
        // Окно 0 минут + подмена времени: проверяем, что протухший ключ
        // вычищается, а не блокирует навсегда.
        const svc = new AlertsService(
          makeConfig({ ALERT_WEBHOOK_URL: baseUrl, ALERT_DEDUP_MINUTES: '60' }),
        );
        const realNow = Date.now;

        await svc.send({ code: 'stale', message: 'msg' });
        expect(received).toHaveLength(1);

        // Сдвигаем «сейчас» на 2 часа вперёд — окно истекло.
        Date.now = () => realNow() + 2 * 60 * 60 * 1000;
        try {
          await svc.send({ code: 'stale', message: 'msg' });
          expect(received).toHaveLength(2);
        } finally {
          Date.now = realNow;
        }
      });
    });
  });

  describe('маскировка секретов в логе', () => {
    it('токен в query не попадает в лог', () => {
      const service = new AlertsService(
        makeConfig({
          ALERT_WEBHOOK_URL: 'https://hooks.example.com/services/T00/B00/XXX?token=SECRET',
        }),
      );
      // Проверяем через приватный статический хелпер напрямую.
      const redacted = (AlertsService as any).redact(
        'https://hooks.example.com/services/T00/B00/XXX?token=SECRET',
      );
      expect(redacted).toBe('https://hooks.example.com/services/T00/B00/XXX');
      expect(redacted).not.toContain('SECRET');
      expect(service.enabled).toBe(true);
    });
  });
});