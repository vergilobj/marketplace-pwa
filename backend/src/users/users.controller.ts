import { Controller, Get, Patch, Post, UseGuards, Request, Body, NotFoundException, Param, Header, Query } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserRole } from '@prisma/client';

@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getProfile(@Request() req) {
    const user = await this.usersService.findById(req.user.userId);
    if (!user) throw new NotFoundException('User not found');
    const { passwordHash, ...result } = user;
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
  async updateProfile(@Request() req, @Body() dto: UpdateUserDto) {
    return this.usersService.updateProfile(req.user.userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/referrals')
  async getMyReferrals(@Request() req) {
    return this.usersService.getReferrals(req.user.userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="users.csv"')
  async exportUsers(): Promise<string> {
    const users = await this.usersService.exportUsers();
    const header = 'ID,Phone,Name,Role,IsApproved,ReferralCode,BonusBalance,CreatedAt\n';
    const csv = users.map(u =>
      `"${u.id}","${u.phone}","${u.name || ''}","${u.role}",${u.isApproved},"${u.referralCode}",${u.bonusBalance},"${u.createdAt?.toISOString() || ''}"`
    ).join('\n');
    return header + csv;
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/balance')
  async getBalance(@Request() req) {
    return this.usersService.getBalance(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/withdrawal')
  async requestWithdrawal(@Request() req, @Body('amount') amount: number) {
    return this.usersService.requestWithdrawal(req.user.userId, amount);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/withdrawals')
  async getMyWithdrawals(@Request() req) {
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
  async getStats(@Request() req) {
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
}