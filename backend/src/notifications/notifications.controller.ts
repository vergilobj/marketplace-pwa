import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

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
    // Заглушка: на фронте будет вызываться с push-токеном и сохраняться в User.
    // Пока просто возвращаем OK.
    return { message: 'Token registration not implemented yet (client-side only)' };
  }
}