import { Controller, Post, Get, Patch, Param, Body, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

  // Внутренние уведомления
  @UseGuards(JwtAuthGuard)
  @Get()
  async getNotifications(@Request() req) {
    return this.notificationsService.getNotifications(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/read')
  async markAsRead(@Param('id') id: string, @Request() req) {
    return this.notificationsService.markAsRead(id, req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('unread-count')
  async getUnreadCount(@Request() req) {
    const count = await this.notificationsService.getUnreadCount(req.user.userId);
    return { count };
  }

  // Push-уведомления (существующие)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('test-all')
  async testAll() {
    await this.notificationsService.sendToAll(
      { en: 'Test Title' },
      { en: 'Test message from marketplace' },
      { screen: 'orders' }
    );
    return { message: 'Sent to all' };
  }

  @UseGuards(JwtAuthGuard)
  @Post('register-token')
  async registerToken() {
    return { message: 'Token registration not implemented yet (client-side only)' };
  }
}