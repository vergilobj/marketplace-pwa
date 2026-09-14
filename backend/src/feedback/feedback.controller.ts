import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import type { AuthenticatedRequest } from '../common/types/authenticated-request.interface';
import {
  PAGINATION_BULK_LIMIT,
  parseLimit,
  parsePage,
} from '../common/dto/pagination.dto';
import { FeedbackService } from './feedback.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { UpdateFeedbackDto } from './dto/update-feedback.dto';
import {
  AdminPostFeedbackMessageDto,
  PostFeedbackMessageDto,
} from './dto/feedback-thread.dto';

/**
 * Роуты живут на двух префиксах (`/feedback` и `/admin/feedback`), поэтому
 * контроллер без @Controller()-префикса — пути заданы на методах целиком.
 *
 * ⚠️ Порядок объявления важен: `feedback/my` объявлен ДО `feedback/:id`,
 * `admin/feedback/stats` — ДО `admin/feedback/:id`. Nest матчит роуты в
 * порядке регистрации, иначе `my`/`stats` уехали бы в `:id`.
 */
@Controller()
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  /** Отправить обращение. Доступно любому авторизованному. */
  @UseGuards(JwtAuthGuard)
  @Post('feedback')
  async create(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreateFeedbackDto,
  ) {
    return this.feedbackService.create(req.user.userId, dto);
  }

  /** Свои обращения (список тредов). */
  @UseGuards(JwtAuthGuard)
  @Get('feedback/my')
  async listMine(
    @Request() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.feedbackService.listMine(req.user.userId, {
      page: parsePage(page),
      limit: parseLimit(limit, PAGINATION_BULK_LIMIT),
    });
  }

  // ─────────────────────────── Админские списки ───────────────────────────
  // Объявлены ДО `feedback/:id`, чтобы `stats` не попал в параметр :id.

  /** Сводка для шапки админки (§4.4 №12). */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  @Get('admin/feedback/stats')
  async stats() {
    return this.feedbackService.getStats();
  }

  /**
   * Все обращения — только ADMIN/MODERATOR.
   * Фильтры: ?status= &assignedTo=me|none|<id> &unreadOnly=1 &q= &page= &limit=
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  @Get('admin/feedback')
  async listAll(
    @Request() req: AuthenticatedRequest,
    @Query('status') status?: string,
    @Query('assignedTo') assignedTo?: string,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.feedbackService.listAll({
      status,
      assignedTo,
      unreadOnly: unreadOnly === '1' || unreadOnly === 'true',
      q,
      page: parsePage(page),
      limit: parseLimit(limit, PAGINATION_BULK_LIMIT),
      viewerId: req.user.userId,
    });
  }

  /** Тред целиком для админа (включая внутренние заметки kind=NOTE). */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  @Get('admin/feedback/:id')
  async adminThread(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.feedbackService.getThread(id, req.user);
  }

  /** Ответ админа. `kind=NOTE` — внутренняя заметка (юзеру не видна). */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  @Post('admin/feedback/:id/messages')
  async adminPostMessage(
    @Param('id') id: string,
    @Body() dto: AdminPostFeedbackMessageDto,
    @Request() req: AuthenticatedRequest,
  ) {
    const body = dto.body ?? dto.text ?? '';
    return this.feedbackService.postAdminMessage(
      id,
      req.user.userId,
      body,
      dto.kind ?? 'TEXT',
    );
  }

  /**
   * Отметить сообщение прочитанным (админская сторона).
   *
   * §4.4 №10: PATCH /admin/feedback/:id/messages/:msgId/read.
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  @Patch('admin/feedback/:id/messages/:msgId/read')
  async adminMarkMessageRead(
    @Param('id') id: string,
    @Param('msgId') msgId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.feedbackService.markMessageRead(id, msgId, req.user);
  }

  /** Закрыть тред (админ). */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  @Post('admin/feedback/:id/close')
  async adminClose(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.feedbackService.closeByAdmin(id, req.user.userId);
  }

  /** Смена статуса/заметки/исполнителя админом. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  @Patch('admin/feedback/:id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateFeedbackDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.feedbackService.update(id, dto, req.user.userId);
  }

  // ─────────────────────────── Тред автора ───────────────────────────

  /** Тред целиком (автор или админ). Помечает прочитанным для этой стороны. */
  @UseGuards(JwtAuthGuard)
  @Get('feedback/:id')
  async thread(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.feedbackService.getThread(id, req.user);
  }

  /** Ответ автора в треде. Body: { body } (алиас { text }). */
  @UseGuards(JwtAuthGuard)
  @Post('feedback/:id/messages')
  async postMessage(
    @Param('id') id: string,
    @Body() dto: PostFeedbackMessageDto,
    @Request() req: AuthenticatedRequest,
  ) {
    const body = dto.body ?? dto.text ?? '';
    return this.feedbackService.postUserMessage(id, req.user.userId, body);
  }

  /** Явная отметка треда прочитанным. */
  @UseGuards(JwtAuthGuard)
  @Post('feedback/:id/read')
  async markRead(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.feedbackService.markThreadReadExplicit(id, req.user);
  }

  /** Закрыть обращение («Решено»). */
  @UseGuards(JwtAuthGuard)
  @Post('feedback/:id/close')
  async close(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.feedbackService.closeByUser(id, req.user.userId);
  }
}
