import { Controller, Get, Patch, Post, UseGuards, Request, Body, NotFoundException, Param, Header } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';

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
  async findAll() {
    return this.usersService.findAll();
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

  // ====== Вывод бонусов ======

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

  // Админские методы для запросов на вывод
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
}