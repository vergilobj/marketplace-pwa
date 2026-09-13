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

/**
 * Роуты живут на двух префиксах (`/feedback` и `/admin/feedback`), поэтому
 * контроллер без @Controller()-префикса — пути заданы на методах целиком.
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

  /** Свои обращения. */
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

  /** Все обращения — только ADMIN. Фильтр ?status=NEW|IN_PROGRESS|CLOSED. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('admin/feedback')
  async listAll(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.feedbackService.listAll({
      status,
      page: parsePage(page),
      limit: parseLimit(limit, PAGINATION_BULK_LIMIT),
    });
  }

  /** Смена статуса/заметки админом. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Patch('admin/feedback/:id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateFeedbackDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.feedbackService.update(id, dto, req.user.userId);
  }
}