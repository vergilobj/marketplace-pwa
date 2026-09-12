import {
  Controller,
  Get,
  Patch,
  Post,
  UseGuards,
  Request,
  Body,
  NotFoundException,
  Param,
  Header,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../common/types/authenticated-request.interface';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserRole } from '@prisma/client';
import {
  parseLimit,
  parsePage,
  PAGINATION_BULK_LIMIT,
} from '../common/dto/pagination.dto';

@Controller('users')
export class UsersController {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}

  /**
   * A4: подать заявку «Стать продавцом». Роль НЕ меняется — ждёт модерации.
   * Возвращает заявку со статусом PENDING.
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BUYER', 'SELLER', 'ADMIN')
  @Post('seller-request')
  async createSellerRequest(@Request() req: AuthenticatedRequest) {
    return this.usersService.createSellerRequest(req.user.userId);
  }

  /** A4: своя заявка — для отображения статуса в профиле. */
  @UseGuards(JwtAuthGuard)
  @Get('seller-request/me')
  async getMySellerRequest(@Request() req: AuthenticatedRequest) {
    return this.usersService.getMySellerRequest(req.user.userId);
  }

  /** A4: список заявок для админки. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('seller-requests')
  async getSellerRequests(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    // L1: потолок limit. Форма ответа — массив (админка читает список).
    return this.usersService.getSellerRequests(status, {
      page: parsePage(page),
      limit: parseLimit(limit, PAGINATION_BULK_LIMIT),
    });
  }

  /** A4: одобрить/отклонить заявку. approve=false → роль не меняется. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Patch('seller-requests/:id')
  async reviewSellerRequest(
    @Param('id') id: string,
    @Body() body: { approve: boolean; note?: string },
    @Request() req: AuthenticatedRequest,
  ) {
    return this.usersService.reviewSellerRequest(
      id,
      req.user.userId,
      Boolean(body?.approve),
      body?.note,
    );
  }

  /**
   * Стать продавцом: BUYER → SELLER.
   * A4: теперь только после одобрения заявки админом (иначе 400).
   * Возвращает обновлённого юзера + свежий accessToken с новой ролью.
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BUYER', 'SELLER', 'ADMIN')
  @Post('become-seller')
  async becomeSeller(@Request() req: AuthenticatedRequest) {
    const user = await this.usersService.becomeSeller(req.user.userId);
    const accessToken = this.jwtService.sign({
      sub: user.id,
      phone: user.phone,
      role: user.role,
    });
    return { user, accessToken };
  }

  /**
   * @deprecated B13: отдаёт phone по номеру — оставлено как есть (вне скоупа L1).
   *
   * PD-FIX-2: читаем ОБА параметра — `phone` и `q`.
   *
   * Раньше контроллер брал только `phone`. Запрос фронта/мониторинга вида
   * `GET /api/users/search?q=test` давал `phone === undefined`, и Prisma падала
   * с PrismaClientValidationError → 500 (`where { phone: undefined }`).
   * Теперь: нет ни `phone`, ни `q` → 400 (а не 500), иначе ищем по номеру.
   *
   * ⚠️ Публичный контракт не расширяем: по-прежнему принимаем номер телефона
   * (этот эндпоинт и был «поиск по номеру»), `q` — алиас для совместимости.
   */
  @UseGuards(JwtAuthGuard)
  @Get('search')
  async searchByPhone(
    @Query('phone') phone?: string,
    @Query('q') q?: string,
  ) {
    const value = phone ?? q;
    if (!value || !String(value).trim()) {
      throw new BadRequestException('Укажите phone или q');
    }
    return this.usersService.findByPhone(String(value).trim());
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getProfile(@Request() req: AuthenticatedRequest) {
    const user = await this.usersService.findById(req.user.userId);
    if (!user) throw new NotFoundException('Пользователь не найден');

    const { passwordHash: _passwordHash, ...result } = user;
    return result;
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get()
  async findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.usersService.findAll({
      page: Number(page) || 1,
      limit: Number(limit) || 20,
      search,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  async updateProfile(
    @Request() req: AuthenticatedRequest,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.updateProfile(req.user.userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/referrals')
  async getMyReferrals(
    @Request() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    // L1: потолок limit. Ответ — массив (ReferralsPage: Array.isArray).
    return this.usersService.getReferrals(req.user.userId, {
      page: parsePage(page),
      limit: parseLimit(limit, PAGINATION_BULK_LIMIT),
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="users.csv"')
  async exportUsers(): Promise<string> {
    const users = await this.usersService.exportUsers();
    const header =
      'ID,Phone,Name,Role,IsApproved,ReferralCode,BonusBalance,CreatedAt\n';
    const csv = users
      .map(
        (u) =>
          `"${u.id}","${u.phone}","${u.name || ''}","${u.role}",${u.isApproved},"${u.referralCode}",${u.bonusBalance},"${u.createdAt?.toISOString() || ''}"`,
      )
      .join('\n');
    return header + csv;
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/balance')
  async getBalance(@Request() req: AuthenticatedRequest) {
    return this.usersService.getBalance(req.user.userId);
  }

  /** §8.2: история операций по журналу (LedgerEntry) с курсорной пагинацией. */
  @UseGuards(JwtAuthGuard)
  @Get('me/ledger')
  async getLedger(
    @Request() req: AuthenticatedRequest,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.usersService.getLedger(req.user.userId, {
      limit: Number(limit) || 20,
      cursor,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/withdrawal')
  async requestWithdrawal(
    @Request() req: AuthenticatedRequest,
    @Body('amount') amount: number,
    @Body('toAddress') toAddress?: string,
  ) {
    return this.usersService.requestWithdrawal(
      req.user.userId,
      amount,
      toAddress,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/withdrawals')
  async getMyWithdrawals(
    @Request() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    // L1: потолок limit. Ответ — массив (WithdrawalsPage).
    return this.usersService.getMyWithdrawalRequests(req.user.userId, {
      page: parsePage(page),
      limit: parseLimit(limit, PAGINATION_BULK_LIMIT),
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('admin/withdrawals')
  async getAllWithdrawals(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    // L1: потолок limit. Ответ — массив (AdminPage).
    return this.usersService.getAllWithdrawalRequests({
      page: parsePage(page),
      limit: parseLimit(limit, PAGINATION_BULK_LIMIT),
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Patch('admin/withdrawals/:id/approve')
  async approveWithdrawal(@Param('id') id: string) {
    return this.usersService.approveWithdrawal(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Patch('admin/withdrawals/:id/reject')
  async rejectWithdrawal(@Param('id') id: string) {
    return this.usersService.rejectWithdrawal(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Patch(':id/role')
  async changeRole(@Param('id') id: string, @Body('role') role: UserRole) {
    return this.usersService.changeRole(id, role);
  }

  // Эндпоинт статистики
  @UseGuards(JwtAuthGuard)
  @Get('me/stats')
  async getStats(@Request() req: AuthenticatedRequest) {
    return this.usersService.getStats(req.user.userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Patch('batch/role')
  async batchChangeRole(@Body() body: { userIds: string[]; role: UserRole }) {
    await this.usersService.batchChangeRole(body.userIds, body.role);
    return { message: 'Roles updated' };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Patch('batch/approve')
  async batchApprove(@Body() body: { userIds: string[] }) {
    await this.usersService.batchApprove(body.userIds);
    return { message: 'Users approved' };
  }

  /**
   * B13: профиль по id. Свой профиль и ADMIN — полный объект.
   * Для остальных — только публичный минимум (id, name, role), без phone и
   * bonusBalance. Публичные поля нужны фронту для карточек продавца.
   */
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async getUserById(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    const isSelf = req.user.userId === id;
    const isAdmin = req.user.role === 'ADMIN';

    const user = await this.usersService.findById(
      id,
      isSelf || isAdmin ? undefined : { id: true, name: true, role: true },
    );
    if (!user) throw new NotFoundException('Пользователь не найден');

    const { passwordHash: _ph, ...result } = user;
    return result;
  }
}
