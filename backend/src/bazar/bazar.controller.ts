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
import { SendBazarMessageDto } from './dto/send-bazar-message.dto';

@Controller('bazar')
@UseGuards(JwtAuthGuard)
export class BazarController {
  constructor(
    private bazarService: BazarService,
    private dealService: DealService,
    private autopilotService: AutopilotService,
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
    return this.bazarService.history(
      req.user.userId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 50,
    );
  }

  /** Список сделок (лиды) текущего юзера. */
  @Get('deals')
  deals(@Req() req: AuthenticatedRequest, @Query('as') as?: string) {
    const role = as === 'seller' ? 'seller' : 'buyer';
    return this.dealService.list(req.user.userId, role);
  }

  /** Тред сделки: Deal + сообщения. */
  @Get('deals/:id')
  dealThread(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.dealService.thread(id, req.user.userId);
  }

  /** Ручная ретрансляция без LLM (fallback). */
  @Post('deals/:id/relay')
  relay(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { text: string },
  ) {
    return this.dealService.relay(req.user.userId, { dealId: id, text: body.text });
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
    @Body() body?: { reason?: string },
  ) {
    return this.dealService.lose(req.user.userId, id, body?.reason);
  }

  /** Контр-оффер (торг). */
  @Post('deals/:id/counter')
  counter(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { amount: number },
  ) {
    return this.dealService.counterOffer(req.user.userId, {
      dealId: id,
      amount: Number(body.amount),
    });
  }

  /** Принять оффер. */
  @Post('deals/:id/offer/:offerId/accept')
  acceptOffer(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('offerId') offerId: string,
  ) {
    return this.dealService.acceptOffer(req.user.userId, { dealId: id, offerId });
  }

  /** Отклонить оффер. */
  @Post('deals/:id/offer/:offerId/reject')
  rejectOffer(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('offerId') offerId: string,
  ) {
    return this.dealService.rejectOffer(req.user.userId, { dealId: id, offerId });
  }

  /** Записать ViewEvent (открытие карточки товара). */
  @Post('views')
  recordView(@Req() req: AuthenticatedRequest, @Body() body: { productId: string }) {
    return this.bazarService.recordView(req.user.userId, body.productId);
  }

  /** Запустить автопилот (или через intent из send). */
  @Post('autopilot/start')
  autopilotStart(
    @Req() req: AuthenticatedRequest,
    @Body() body: { goal: string; budget?: number },
  ) {
    return this.autopilotService.start(req.user.userId, body.goal, body.budget);
  }

  /** Продолжить автопилот ответом юзера. */
  @Post('autopilot/resume')
  autopilotResume(
    @Req() req: AuthenticatedRequest,
    @Body() body: { type: 'confirm' | 'refine'; accept?: boolean; productId?: string; feedback?: string },
  ) {
    return this.autopilotService.resume(req.user.userId, body);
  }

  /** Сгенерировать описание товара (фича 6). */
  @Post('products/generate')
  generateDescription(@Req() req: AuthenticatedRequest, @Body() body: { rawText: string }) {
    void req;
    return this.bazarService.generateDescription(body.rawText);
  }

  /** Прочитать trustScore пользователя. */
  @Get('users/:id/trust')
  getTrust(@Param('id') id: string) {
    return this.bazarService.getTrustScore(id);
  }
}