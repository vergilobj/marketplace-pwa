/**
 * Эндпоинты базы знаний (§6.4 №17–26).
 *
 * Роли: всё — ADMIN/MODERATOR (это внутренний инструмент админа; юзер с
 * базой знаний не работает, он получает её ответы через консультанта).
 *
 * ⚠️ Порядок объявления важен: `admin/knowledge/candidates`,
 * `admin/knowledge/stats`, `admin/knowledge/search-preview` объявлены ДО
 * `admin/knowledge/:id` — Nest матчит роуты в порядке регистрации, иначе
 * `stats` уехал бы в параметр `:id`.
 */
import {
  Body,
  Controller,
  Delete,
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
import { KnowledgeService } from './knowledge.service';
import {
  ApproveCandidateDto,
  CreateKnowledgeDto,
  SearchPreviewDto,
  SetKnowledgeStatusDto,
  UpdateKnowledgeDto,
} from './dto/knowledge.dto';

@Controller()
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  // ─────────────────────────── Кандидаты ───────────────────────────
  // Объявлены ДО `:id`, иначе `candidates` уехал бы в параметр.

  /** Кандидаты PENDING/REVIEW со связанными тредами (§6.4 №22). */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  @Get('admin/knowledge/candidates')
  async candidates(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.knowledgeService.listCandidates({
      status,
      page: parsePage(page),
      limit: parseLimit(limit, PAGINATION_BULK_LIMIT),
    });
  }

  /** Сводка по базе знаний (§6.4 №25). */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  @Get('admin/knowledge/stats')
  async stats() {
    return this.knowledgeService.getStats();
  }

  /** Что найдёт поиск по этому тексту (§6.4 №26) — отладка порогов. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  @Post('admin/knowledge/search-preview')
  async searchPreview(@Body() dto: SearchPreviewDto) {
    return this.knowledgeService.searchPreview(dto.text, dto.productId ?? null);
  }

  /** Принять кандидата в знание (§6.4 №23, ПУТЬ A). */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  @Post('admin/knowledge/from-candidate/:candidateId')
  async approveCandidate(
    @Param('candidateId') candidateId: string,
    @Body() dto: ApproveCandidateDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.knowledgeService.approveCandidate(
      candidateId,
      {
        question: dto.question,
        answer: dto.answer,
        answerShort: dto.answerShort,
        category: dto.category,
        tags: dto.tags,
        productId: dto.productId,
        mergeInto: dto.mergeInto,
      },
      req.user.userId,
    );
  }

  /** Отклонить кандидата (§6.4 №24). */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  @Post('admin/knowledge/candidates/:id/reject')
  async rejectCandidate(@Param('id') id: string) {
    return this.knowledgeService.rejectCandidate(id);
  }

  // ─────────────────────────── Знания ───────────────────────────

  /** Список знаний с фильтрами (§6.4 №17). */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  @Get('admin/knowledge')
  async list(
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('productId') productId?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.knowledgeService.list({
      status,
      category,
      productId,
      q,
      page: parsePage(page),
      limit: parseLimit(limit, PAGINATION_BULK_LIMIT),
    });
  }

  /** Создать знание (§6.4 №18, ПУТЬ B). */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  @Post('admin/knowledge')
  async create(
    @Body() dto: CreateKnowledgeDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.knowledgeService.create(dto, req.user.userId);
  }

  /** Одно знание (для формы правки в админке). */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  @Get('admin/knowledge/:id')
  async getOne(@Param('id') id: string) {
    return this.knowledgeService.getById(id);
  }

  /** Правка знания (§6.4 №19). Смена question → пересчёт questionNorm. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  @Patch('admin/knowledge/:id')
  async update(@Param('id') id: string, @Body() dto: UpdateKnowledgeDto) {
    return this.knowledgeService.update(id, dto);
  }

  /** Смена статуса (§6.4 №21): ACTIVE | STALE | ARCHIVED | REVIEW | DRAFT. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  @Post('admin/knowledge/:id/status')
  async setStatus(
    @Param('id') id: string,
    @Body() dto: SetKnowledgeStatusDto,
  ) {
    return this.knowledgeService.setStatus(id, dto.status);
  }

  /** Удаление — мягкое: status=ARCHIVED (§6.4 №20). */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  @Delete('admin/knowledge/:id')
  async remove(@Param('id') id: string) {
    return this.knowledgeService.archive(id);
  }
}