import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

/**
 * Мок ArgumentsHost (HTTP) с захватом того, что реально ушло в response.
 */
function createHttpHost(req: any = {}) {
  const captured: { status?: number; body?: any; ended?: boolean } = {};

  const response = {
    headersSent: false,
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: any) {
      captured.body = body;
      return this;
    },
    end() {
      captured.ended = true;
      return this;
    },
  };

  const host = {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({
        method: req.method ?? 'POST',
        originalUrl: req.originalUrl ?? '/test',
        user: req.user,
      }),
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;

  return { host, captured };
}

function createWsHost() {
  const host = {
    getType: () => 'ws',
    switchToHttp: () => {
      throw new Error('not http');
    },
  } as unknown as ArgumentsHost;
  return host;
}

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    // глушим лог, чтобы не сорить в выводе тестов
    (filter as any).logger = { error: jest.fn(), warn: jest.fn() };
  });

  describe('HttpException — пропускается как есть (обратная совместимость)', () => {
    it('UnauthorizedException(string) → 401 {statusCode, message}', () => {
      const { host, captured } = createHttpHost();
      filter.catch(new UnauthorizedException('Требуется токен'), host);

      expect(captured.status).toBe(401);
      // Nest HttpException.createBody(string) → {message, error, statusCode}
      expect(captured.body).toEqual({
        statusCode: 401,
        message: 'Требуется токен',
        error: 'Unauthorized',
      });
    });

    it('NotFoundException() → 404 со дефолтной формой Nest', () => {
      const { host, captured } = createHttpHost();
      filter.catch(new NotFoundException(), host);

      expect(captured.status).toBe(404);
      // Без аргументов createBody(undefined, 'Not Found') → error-поля НЕТ
      expect(captured.body).toEqual({
        statusCode: 404,
        message: 'Not Found',
      });
    });

    it('BadRequestException(object) с массивом message сохраняется как есть (ValidationPipe)', () => {
      const { host, captured } = createHttpHost();
      const payload = {
        statusCode: 400,
        message: ['phone must be a string', 'name should not be empty'],
        error: 'Bad Request',
      };
      filter.catch(new BadRequestException(payload), host);

      expect(captured.status).toBe(400);
      expect(captured.body).toEqual(payload);
      expect(Array.isArray(captured.body.message)).toBe(true);
    });

    it('ForbiddenException → 403', () => {
      const { host, captured } = createHttpHost();
      filter.catch(new ForbiddenException('Недостаточно прав'), host);

      expect(captured.status).toBe(403);
      expect(captured.body).toEqual({
        statusCode: 403,
        message: 'Недостаточно прав',
        error: 'Forbidden',
      });
    });

    it('HttpException без message-строки не заворачивается', () => {
      const { host, captured } = createHttpHost();
      filter.catch(
        new HttpException({ custom: 'shape' }, HttpStatus.CONFLICT),
        host,
      );

      expect(captured.status).toBe(409);
      expect(captured.body).toEqual({ custom: 'shape' });
    });
  });

  describe('Неизвестное исключение → 500 без утечек', () => {
    it('plain Error → 500 generic, без stack/message наружу', () => {
      const { host, captured } = createHttpHost();
      filter.catch(new Error('secret db password leaked'), host);

      expect(captured.status).toBe(500);
      expect(captured.body).toEqual({
        statusCode: 500,
        message: 'Internal server error',
        error: 'Internal Server Error',
      });
      expect(JSON.stringify(captured.body)).not.toContain('secret db password');
    });

    it('Prisma-подобная ошибка → 500 без имён классов Prisma', () => {
      const { host, captured } = createHttpHost();
      const prismaErr: any = new Error(
        'Invalid `prisma.user.findUnique()` invocation',
      );
      prismaErr.name = 'PrismaClientKnownRequestError';
      prismaErr.stack =
        'PrismaClientKnownRequestError: \n    at /Users/vergilobj/marketplace-pwa/backend/node_modules/@prisma/client/runtime/library.js:1:1';

      filter.catch(prismaErr, host);

      const serialized = JSON.stringify(captured.body);
      expect(captured.status).toBe(500);
      expect(serialized).not.toContain('PrismaClientKnownRequestError');
      expect(serialized).not.toContain('node_modules');
      expect(serialized).not.toContain('/Users/');
      expect(serialized).not.toContain('prisma.user.findUnique');
      expect(serialized).not.toContain('at ');
    });

    it('http-errors-подобный объект: статус сохраняется, путь вырезается', () => {
      const { host, captured } = createHttpHost();
      const err: any = new Error('ENOENT: /Users/vergilobj/marketplace-pwa/.env');
      err.statusCode = 500;

      filter.catch(err, host);

      expect(captured.status).toBe(500);
      expect(JSON.stringify(captured.body)).not.toContain('/Users/');
    });

    it('не-Error throw (строка) → 500 generic', () => {
      const { host, captured } = createHttpHost();
      filter.catch('странный throw', host);

      expect(captured.status).toBe(500);
      expect(captured.body.statusCode).toBe(500);
    });

    it('undefined → 500 generic, не падает', () => {
      const { host, captured } = createHttpHost();
      expect(() => filter.catch(undefined, host)).not.toThrow();
      expect(captured.status).toBe(500);
    });
  });

  describe('Контекст и логирование', () => {
    it('логирует 5xx как error, 4xx как warn, с методом/путём/userId', () => {
      const { host } = createHttpHost({
        method: 'PATCH',
        originalUrl: '/posts/123',
        user: { userId: 'user-42' },
      });

      filter.catch(new NotFoundException(), host);
      expect((filter as any).logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('PATCH /posts/123 user=user-42 status=404'),
      );

      filter.catch(new Error('boom'), host);
      expect((filter as any).logger.error).toHaveBeenCalledWith(
        expect.stringContaining('PATCH /posts/123 user=user-42 status=500'),
        expect.anything(),
      );
    });

    it('не ломается, если user в запросе отсутствует', () => {
      const { host, captured } = createHttpHost();
      expect(() => filter.catch(new Error('x'), host)).not.toThrow();
      expect((filter as any).logger.error).toHaveBeenCalledWith(
        expect.stringContaining('user=-'),
        expect.anything(),
      );
      expect(captured.status).toBe(500);
    });
  });

  describe('Не-HTTP контекст', () => {
    it('WS-контекст не трогает и не бросает', () => {
      const host = createWsHost();
      expect(() => filter.catch(new Error('ws boom'), host)).not.toThrow();
    });
  });

  describe('headersSent', () => {
    it('если заголовки уже отправлены — не пишем тело повторно', () => {
      const { host, captured } = createHttpHost();
      const response = (host as any).switchToHttp().getResponse();
      response.headersSent = true;

      filter.catch(new Error('late'), host);

      expect(captured.body).toBeUndefined();
      expect(captured.ended).toBe(true);
    });
  });
});