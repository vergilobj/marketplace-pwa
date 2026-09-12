import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Param,
  Body,
  UseGuards,
  Request,
  Query,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../common/types/authenticated-request.interface';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PostsService } from './posts.service';
import { CreatePostDto } from './dto/create-post.dto';
import { CreateAdDto } from './dto/create-ad.dto';
import { parseLimit, parsePage } from '../common/dto/pagination.dto';

@Controller('posts')
export class PostsController {
  constructor(private postsService: PostsService) {}

  @UseGuards(OptionalJwtAuthGuard)
  @Get('feed')
  async feed(
    @Request() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sort') sort?: string,
    @Query('search') search?: string,
    @Query('q') q?: string,
  ) {
    return this.postsService.getFeed({
      userId: req.user?.userId,
      page: parsePage(page),
      limit: parseLimit(limit),
      sort: sort || 'newest',
      search: search || q || undefined,
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BUYER', 'SELLER', 'ADMIN')
  @Post()
  async create(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreatePostDto,
  ) {
    return this.postsService.create(req.user.userId, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SELLER', 'ADMIN')
  @Post('ad')
  async createAd(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreateAdDto,
  ) {
    return this.postsService.createAd(req.user.userId, dto);
  }

  @Get()
  async findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sort') sort?: string,
    @Query('search') search?: string,
    @Query('q') q?: string,
  ) {
    return this.postsService.findAll({
      page: parsePage(page),
      limit: parseLimit(limit),
      sort: sort || 'newest',
      search: search || q || undefined,
    });
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id')
  async findById(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    // G3: role нужен, чтобы неоплаченную рекламу видели автор и ADMIN (404 — остальным).
    return this.postsService.findById(id, req.user?.userId, req.user?.role);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.postsService.delete(id);
  }

  // Админские эндпоинты
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('admin/list')
  async findAllAdmin(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    return this.postsService.findAllAdmin({
      page: parsePage(page),
      limit: parseLimit(limit),
      search,
      status,
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Patch(':id/toggle-visibility')
  async toggleVisibility(@Param('id') id: string) {
    return this.postsService.toggleVisibility(id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreatePostDto,
  ) {
    return this.postsService.update(id, req.user.userId, req.user.role, dto);
  }
}
