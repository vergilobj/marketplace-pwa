import {
  Controller,
  Post,
  Delete,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SocialService } from './social.service';

@Controller('social')
export class SocialController {
  constructor(private socialService: SocialService) {}

  @UseGuards(JwtAuthGuard)
  @Post(':postId/like')
  async like(@Request() req, @Param('postId') postId: string) {
    return this.socialService.likePost(req.user.userId, postId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':postId/like')
  async unlike(@Request() req, @Param('postId') postId: string) {
    return this.socialService.unlikePost(req.user.userId, postId);
  }

  @Get(':postId/likes')
  async getLikes(@Param('postId') postId: string) {
    return this.socialService.getLikes(postId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':postId/comments')
  async addComment(
    @Request() req,
    @Param('postId') postId: string,
    @Body('text') text: string,
  ) {
    return this.socialService.addComment(req.user.userId, postId, text);
  }

  @Get(':postId/comments')
  async getComments(@Param('postId') postId: string) {
    return this.socialService.getComments(postId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('comments/:commentId')
  async updateComment(
    @Request() req,
    @Param('commentId') commentId: string,
    @Body('text') text: string,
  ) {
    return this.socialService.updateComment(
      commentId,
      req.user.userId,
      req.user.role,
      text,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Delete('comments/:commentId')
  async deleteComment(@Request() req, @Param('commentId') commentId: string) {
    return this.socialService.deleteComment(
      commentId,
      req.user.userId,
      req.user.role,
    );
  }
}
