import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../common/types/authenticated-request.interface';
import {
  PAGINATION_DEFAULT_LIMIT,
  parseLimit,
  parsePage,
} from '../common/dto/pagination.dto';
import { ConsultService } from './consult.service';
import { AskConsultDto, CallAdminDto, RateConsultDto } from './dto/consult.dto';

/**
 * REST ИИ-консультанта (§5.5 №13–16).
 *
 * Префикс `consult` объявлен на @Controller, потому что все роуты живут под
 * ним (в отличие от feedback, где два префикса).
 *
 * ⚠️ Порядок объявления важен: `consult/history` и `consult/call-admin`
 * объявлены ДО `consult/:logId/rate`. Nest матчит роуты в порядке
 * регистрации, иначе `history` уехал бы в параметр.
 *
 * Роли: все роуты — любой авторизованный (PUB). Ownership проверяется в
 * сервисе (`ConsultLog.userId`), админских ручек на этом этапе нет.
 */
@Controller('consult')
@UseGuards(JwtAuthGuard)
export class ConsultController {
  constructor(private readonly consultService: ConsultService) {}

  /** Задать вопрос консультанту. */
  @Post('ask')
  async ask(@Request() req: AuthenticatedRequest, @Body() dto: AskConsultDto) {
    return this.consultService.ask(req.user.userId, {
      text: dto.text,
      productId: dto.productId ?? null,
      route: dto.route ?? null,
    });
  }

  /** Своя история вопросов (пагинация). */
  @Get('history')
  async history(
    @Request() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.consultService.history(req.user.userId, {
      page: parsePage(page),
      limit: parseLimit(limit, PAGINATION_DEFAULT_LIMIT),
    });
  }

  /** Явно позвать админа (создать/дополнить тред). */
  @Post('call-admin')
  async callAdmin(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CallAdminDto,
  ) {
    return this.consultService.callAdmin(req.user.userId, {
      text: dto.text,
      feedbackId: dto.feedbackId ?? null,
    });
  }

  /** Оценить полезность ответа. */
  @Post(':logId/rate')
  async rate(
    @Request() req: AuthenticatedRequest,
    @Param('logId') logId: string,
    @Body() dto: RateConsultDto,
  ) {
    return this.consultService.rate(req.user.userId, logId, dto.helpful);
  }
}