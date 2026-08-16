import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  UseGuards,
  Request,
  Body,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../common/types/authenticated-request.interface';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { InvitesService } from './invites.service';

@Controller('invites')
export class InvitesController {
  constructor(private invitesService: InvitesService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  @Post()
  async create(
    @Request() req: AuthenticatedRequest,
    @Body('code') code?: string,
  ) {
    return this.invitesService.createInvite(req.user.userId, code);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  @Get()
  async findAll() {
    return this.invitesService.findAll();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Delete(':code')
  async delete(@Param('code') code: string) {
    return this.invitesService.delete(code);
  }
}
