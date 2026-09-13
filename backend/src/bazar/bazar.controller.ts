import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../common/types/authenticated-request.interface';
import { BazarService } from './bazar.service';
import { DealService } from './deal.service';
import { AutopilotService } from './autopilot.service';
import { ReputationService } from './reputation.service';
import { SendBazarMessageDto } from './dto/send-bazar-message.dto';
import { DealRelayDto } from './dto/deal-relay.dto';
import { DealCounterDto } from './dto/deal-counter.dto';
import { DealReasonDto } from './dto/deal-reason.dto';
import { RecordViewDto } from './dto/record-view.dto';
import { AutopilotStartDto } from './dto/autopilot-start.dto';
import { AutopilotResumeDto } from './dto/autopilot-resume.dto';
import { GenerateDescriptionDto } from './dto/generate-description.dto';
import {
  DEAL_THREAD_DEFAULT_LIMIT,
  DEAL_THREAD_MAX_LIMIT,
  PAGINATION_BULK_LIMIT,
  parseLimit,
  parsePage,
} from '../common/dto/pagination.dto';

@Controller('bazar')
@UseGuards(JwtAuthGuard)
export class BazarController {
  constructor(
    private bazarService: BazarService,
    private dealService: DealService,
    private autopilotService: AutopilotService,
    private reputationService: ReputationService,
  ) {}

  /** Идемпотентное приветствие. Вызывается фронтом после логина. */
  @Post('welcome')
  welcome(@Req() req: AuthenticatedRequest) {
    return this.bazarService.ensureWelcome(req.user.userId);
  }

  /** Не-стриминговый send (MVP). */
  @Post('messages')
  send(@Req() req: AuthenticatedRequest, @Body() dto: SendBazarMessageDto) {
    return this.bazarService.send(req.user.userId, dto.text);
  }

  /** Полный сброс диалога: новая сессия + новое приветствие. */
  @Post('reset')
  reset(@Req() req: AuthenticatedRequest) {
    return this.bazarService.reset(req.user.userId);
  }

  @Get('messages')
  history(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    // L1: parseLimit даёт 400 на мусор и кламп >100; дефолт 50 (как было).
    return this.bazarService.history(
      req.user.userId,
      parsePage(page),
      parseLimit(limit, 50),
    );
  }

  /** Список сделок (лиды) текущего юзера. */
  @Get('deals')
  deals(
    @Req() req: AuthenticatedRequest,
    @Query('as') as?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const role = as === 'seller' ? 'seller' : 'buyer';
    return this.dealService.list(req.user.userId, role, {
      page: parsePage(page),
      limit: parseLimit(limit, PAGINATION_BULK_LIMIT),
    });
  }

  /** Тред сделки: Deal + сообщения. */
  @Get('deals/:id')
  dealThread(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.dealService.thread(id, req.user.userId, {
      page: parsePage(page),
      limit: parseLimit(
        limit,
        DEAL_THREAD_DEFAULT_LIMIT,
        DEAL_THREAD_MAX_LIMIT,
      ),
    });
  }

  /** Ручная ретрансляция без LLM (fallback). */
  @Post('deals/:id/relay')
  relay(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: DealRelayDto,
  ) {
    return this.dealService.relay(req.user.userId, {
      dealId: id,
      text: body.text,
    });
  }

  /** «беру» напрямую с фронта. */
  @Post('deals/:id/accept')
  accept(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.dealService.accept(req.user.userId, id);
  }

  /** Отмена сделки. */
  @Post('deals/:id/cancel')
  cancel(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: DealReasonDto = {},
  ) {
    return this.dealService.lose(req.user.userId, id, body.reason);
  }

  /** Контр-оффер (торг). */
  @Post('deals/:id/counter')
  counter(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: DealCounterDto,
  ) {
    return this.dealService.counterOffer(req.user.userId, {
      dealId: id,
      amount: body.amount,
    });
  }

  /** Принять оффер. */
  @Post('deals/:id/offer/:offerId/accept')
  acceptOffer(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('offerId') offerId: string,
  ) {
    return this.dealService.acceptOffer(req.user.userId, {
      dealId: id,
      offerId,
    });
  }

  /** Отклонить оффер. */
  @Post('deals/:id/offer/:offerId/reject')
  rejectOffer(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('offerId') offerId: string,
  ) {
    return this.dealService.rejectOffer(req.user.userId, {
      dealId: id,
      offerId,
    });
  }

  /** N2: открыть спор по сделке (доступно участникам). Запускает нейро-арбитраж. */
  @Post('deals/:id/dispute')
  dispute(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: DealReasonDto = {},
  ) {
    return this.dealService.openDispute(req.user.userId, id, body.reason);
  }

  /** Записать ViewEvent (открытие карточки товара). */
  @Post('views')
  recordView(
    @Req() req: AuthenticatedRequest,
    @Body() body: RecordViewDto,
  ) {
    return this.bazarService.recordView(req.user.userId, body.productId);
  }

  /** Запустить автопилот (или через intent из send). */
  @Post('autopilot/start')
  autopilotStart(
    @Req() req: AuthenticatedRequest,
    @Body() body: AutopilotStartDto,
  ) {
    return this.autopilotService.start(req.user.userId, body.goal, body.budget);
  }

  /** Продолжить автопилот ответом юзера. */
  @Post('autopilot/resume')
  autopilotResume(
    @Req() req: AuthenticatedRequest,
    @Body() body: AutopilotResumeDto,
  ) {
    return this.autopilotService.resume(req.user.userId, body);
  }

  /** Сгенерировать описание товара (фича 6). */
  @Post('products/generate')
  generateDescription(
    @Req() req: AuthenticatedRequest,
    @Body() body: GenerateDescriptionDto,
  ) {
    void req;
    return this.bazarService.generateDescription(body.rawText);
  }

  /**
   * N9 + N16: репутация пользователя.
   * Решение по N16: trustScore публичен ТОЛЬКО для продавцов (у кого есть
   * товары). Свой профиль и ADMIN/MODERATOR видят всегда. Иначе — 403,
   * чтобы нельзя было перебором id собрать trustScore всех юзеров.
   */
  @Get('users/:id/trust')
  getTrust(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    // GAPS-A: анти-enumeration. Раньше несуществующий id → 404, а
    // существующий-не-продавец → 403 — перебором id можно было узнать, кто
    // зарегистрирован. Теперь оба случая дают ОДИН и тот же 403 (сервис).
    return this.reputationService.publicTrust(id, req.user);
  }
}
