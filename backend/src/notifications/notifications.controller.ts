import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../common/prisma/prisma.service';

@Controller('notifications')
export class NotificationsController {
  constructor(
    private notificationsService: NotificationsService,
    private prisma: PrismaService,
  ) {}

  // Внутренние уведомления
  @UseGuards(JwtAuthGuard)
  @Get()
  async getNotifications(@Request() req: AuthenticatedRequest) {
    return this.notificationsService.getNotifications(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/read')
  async markAsRead(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.notificationsService.markAsRead(id, req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('unread-count')
  async getUnreadCount(@Request() req: AuthenticatedRequest) {
    const count = await this.notificationsService.getUnreadCount(
      req.user.userId,
    );
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
      { screen: 'orders' },
    );
    return { message: 'Sent to all' };
  }

  @UseGuards(JwtAuthGuard)
  @Post('register-token')
  registerToken() {
    return {
      message: 'Token registration not implemented yet (client-side only)',
    };
  }

  @UseGuards(JwtAuthGuard)
  @Patch('read-all')
  async markAllAsRead(@Request() req: AuthenticatedRequest) {
    await this.notificationsService.markAllAsRead(req.user.userId);
    return { message: 'All notifications marked as read' };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('broadcast')
  async broadcast(
    @Body('message') message: string,
    @Body('role') role?: string,
  ) {
    // Получаем всех пользователей (или по роли)
    const users = await this.prisma.user.findMany({
      where: role ? { role: role as any } : {},
      select: { id: true },
    });

    for (const user of users) {
      await this.notificationsService.createNotification(
        user.id,
        'broadcast',
        message,
      );
    }

    return { message: `Sent to ${users.length} users` };
  }
}
