import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class SocialService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  async likePost(userId: string, postId: string) {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post) throw new NotFoundException('Post not found');

    try {
      await this.prisma.like.create({
        data: { userId, postId },
      });
      // Уведомление автору поста
      if (post.authorId !== userId) {
        await this.notificationsService.createNotification(
          post.authorId,
          'like',
          `Кто-то лайкнул ваш пост`,
          postId,
        );
      }
      return { liked: true };
    } catch (e) {
      if (e.code === 'P2002') throw new ConflictException('Already liked');
      throw e;
    }
  }

  async unlikePost(userId: string, postId: string) {
    const like = await this.prisma.like.findUnique({
      where: { userId_postId: { userId, postId } },
    });
    if (!like) throw new NotFoundException('Like not found');
    await this.prisma.like.delete({ where: { id: like.id } });
    return { liked: false };
  }

  async getLikes(postId: string) {
    return this.prisma.like.findMany({
      where: { postId },
      include: { user: { select: { id: true, name: true } } },
    });
  }

  async addComment(userId: string, postId: string, text: string) {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post) throw new NotFoundException('Post not found');

    const comment = await this.prisma.comment.create({
      data: { userId, postId, text },
      include: { user: { select: { id: true, name: true } } },
    });

    // Уведомление автору поста
    if (post.authorId !== userId) {
      await this.notificationsService.createNotification(
        post.authorId,
        'comment',
        `Новый комментарий к вашему посту`,
        postId,
      );
    }
    return comment;
  }

  async getComments(postId: string) {
    return this.prisma.comment.findMany({
      where: { postId },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, name: true } } },
    });
  }

  async deleteComment(commentId: string, userId: string) {
    const comment = await this.prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment || comment.userId !== userId) throw new NotFoundException();
    await this.prisma.comment.delete({ where: { id: commentId } });
    return { deleted: true };
  }
}