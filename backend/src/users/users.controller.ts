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
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../common/types/authenticated-request.interface';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserRole } from '@prisma/client';

@Controller('users')
export class UsersController {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}

  /**
   * Стать продавцом: BUYER → SELLER.
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

  /** @deprecated B13: отдаёт phone по номеру — оставлено как есть (вне скоупа L1). */
  @UseGuards(JwtAuthGuard)
  @Get('search')
  async searchByPhone(@Query('phone') phone: string) {
    return this.usersService.findByPhone(phone);
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
  async getMyReferrals(@Request() req: AuthenticatedRequest) {
    return this.usersService.getReferrals(req.user.userId);
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
  async getMyWithdrawals(@Request() req: AuthenticatedRequest) {
    return this.usersService.getMyWithdrawalRequests(req.user.userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('admin/withdrawals')
  async getAllWithdrawals() {
    return this.usersService.getAllWithdrawalRequests();
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
