import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

/**
 * CWE-209: безопасный ответ на неизвестное исключение.
 * Совпадает с дефолтным сообщением NestJS ('Internal server error'),
 * чтобы не менять форму ответа для существующих тестов.
 */
const SAFE_500_MESSAGE = 'Internal server error';

/**
 * Признаки утечки внутренних деталей: stack trace, абсолютные пути,
 * node_modules, имена классов Prisma и прочих внутренних библиотек.
 */
const LEAK_PATTERNS: RegExp[] = [
  /\n\s*at\s/, // stack trace
  /node_modules/i,
  /(^|\s|\/)[A-Za-z]:\\|\/Users\/|\/home\/|\/var\/|\/private\//, // абсолютные пути
  /\.(ts|js):\d+/, // файл:строка
  /PrismaClient\w*(Error|KnownRequestError|ValidationError)/,
  /PrismaClientInitializationError/,
  /\bprisma\.[a-zA-Z]+\./,
];

function isPlainObject(value: unknown): boolean {
  return (
    typeof value === 'function' ||
    (typeof value === 'object' && value !== null && !Array.isArray(value))
  );
}

function looksLikeLeak(message: unknown): boolean {
  if (typeof message !== 'string') return false;
  return LEAK_PATTERNS.some((re) => re.test(message));
}

/**
 * Глобальный фильтр исключений.
 *
 * Контракт (важно для обратной совместимости):
 *  - `HttpException` (400/401/403/404/409/429/...) отдаётся РОВНО как дефолтным
 *    NestJS: object-response → как есть, string-response → `{statusCode, message}`
 *    (иначе ломаются существующие тесты и контракты API).
 *  - Неизвестное исключение → 500 + generic `{statusCode, message, error}`,
 *    без stack trace, путей и имён классов Prisma.
 *  - Всё пишется в лог с контекстом (метод, путь, userId).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    // Фильтр регистрируется глобально для HTTP. Для не-HTTP контекстов
    // (WS/RPC) глобальные HTTP-фильтры NestJS не применяет — на всякий случай
    // не вмешиваемся, только логируем.
    if (host.getType() !== 'http') {
      this.logException(exception, host);
      return;
    }

    const http = host.switchToHttp();
    const response = http.getResponse();
    const request = http.getRequest();

    this.logException(exception, host);

    if (exception instanceof HttpException) {
      this.replyHttpException(exception, response);
      return;
    }

    this.replyUnknownException(exception, response);
  }

  // ---------------------------------------------------------------------
  // HttpException — байт-в-байт как дефолтный BaseExceptionFilter
  // ---------------------------------------------------------------------
  private replyHttpException(exception: HttpException, response: any): void {
    const res = exception.getResponse();
    const message = isPlainObject(res)
      ? res
      : {
          statusCode: exception.getStatus(),
          message: res,
        };

    this.reply(response, message, exception.getStatus());
  }

  // ---------------------------------------------------------------------
  // Неизвестное исключение — 500 без внутренних деталей
  // ---------------------------------------------------------------------
  private replyUnknownException(exception: unknown, response: any): void {
    const err = exception as { statusCode?: unknown; message?: unknown };

    if (
      err &&
      typeof err === 'object' &&
      typeof err.statusCode === 'number' &&
      typeof err.message === 'string'
    ) {
      // http-errors-подобный объект: статус сохраняем, но сообщение чистим.
      const message = looksLikeLeak(err.message)
        ? SAFE_500_MESSAGE
        : err.message;
      this.reply(
        response,
        {
          statusCode: err.statusCode,
          message,
          error: HttpStatus[err.statusCode] || 'Error',
        },
        err.statusCode,
      );
      return;
    }

    this.reply(
      response,
      {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: SAFE_500_MESSAGE,
        error: 'Internal Server Error',
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  private reply(response: any, body: unknown, status: number): void {
    if (typeof response.status === 'function') {
      if (response.headersSent) {
        response.end();
        return;
      }
      response.status(status).json(body);
      return;
    }
    if (typeof response.end === 'function') {
      response.end();
    }
  }

  // ---------------------------------------------------------------------
  // Логирование с контекстом
  // ---------------------------------------------------------------------
  private logException(exception: unknown, host: ArgumentsHost): void {
    let method = '-';
    let url = '-';
    let userId = '-';

    try {
      if (host.getType() === 'http') {
        const req = host.switchToHttp().getRequest();
        method = req?.method ?? '-';
        url = req?.originalUrl ?? req?.url ?? '-';
        userId = req?.user?.userId ?? '-';
      } else {
        method = `ws:${host.getType()}`;
      }
    } catch {
      // контекст недоступен — логируем без него
    }

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : ((exception as { statusCode?: number })?.statusCode ?? 500);

    const name = exception instanceof Error ? exception.name : typeof exception;
    const message = exception instanceof Error ? exception.message : String(exception);
    const stack = exception instanceof Error ? exception.stack : undefined;

    const context = `${method} ${url} user=${userId} status=${status}`;

    if (status >= 500) {
      this.logger.error(`[${name}] ${message} (${context})`, stack);
    } else {
      this.logger.warn(`[${name}] ${message} (${context})`);
    }
  }
}