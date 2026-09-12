import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ModerationService } from '../moderation/moderation.service';
import {
  PAGINATION_BULK_LIMIT,
  clampLimit,
  clampPage,
} from '../common/dto/pagination.dto';

@Injectable()
export class SocialService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private notificationsService: NotificationsService,
    private moderationService: ModerationService,
  ) {}

  async likePost(userId: string, postId: string) {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post) throw new NotFoundException('Пост не найден');

    try {
      await this.prisma.like.create({ data: { userId, postId } });
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
      if (e.code === 'P2002') throw new ConflictException('Уже лайкнуто');
      throw e;
    }
  }

  async unlikePost(userId: string, postId: string) {
    const like = await this.prisma.like.findUnique({
      where: { userId_postId: { userId, postId } },
    });
    if (!like) throw new NotFoundException('Лайк не найден');
    await this.prisma.like.delete({ where: { id: like.id } });
    return { liked: false };
  }

  /**
   * L1: лайки поста. Раньше `findMany` без `take` — пост-вирус отдавал все
   * лайки разом.
   *
   * ⚠️ Совместимость: ответ читается фронтом как МАССИВ. Форму не меняем.
   * Дефолт 100 — у обычного поста лайков меньше, UI ничего не теряет.
   */
  async getLikes(postId: string, params: { page?: number; limit?: number } = {}) {
    const page = clampPage(params.page, 1);
    const limit = clampLimit(params.limit, PAGINATION_BULK_LIMIT);
    return this.prisma.like.findMany({
      where: { postId },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    });
  }

  async addComment(userId: string, postId: string, text: string) {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post) throw new NotFoundException('Пост не найден');

    const moderation = await this.moderationService.moderate({
      text,
      entityType: 'comment',
      userId,
    });
    if (moderation.verdict === 'block') {
      throw new BadRequestException(moderation.reason);
    }

    const comment = await this.prisma.comment.create({
      data: { userId, postId, text },
      include: { user: { select: { id: true, name: true } } },
    });

    if (post.authorId !== userId) {
      await this.notificationsService.createNotification(
        post.authorId,
        'comment',
        `Новый комментарий к вашему посту`,
        postId,
      );
    }
    await this.auditService.log({
      userId,
      action: 'comment_created',
      entity: 'comment',
      entityId: comment.id,
    });
    return comment;
  }

  /**
   * L1: комментарии поста. Раньше `findMany` без `take` — пост-вирус отдавал
   * все комментарии.
   *
   * ⚠️ Совместимость: фронт (`PostDetailPage`) читает ответ как МАССИВ и
   * показывает `comments.length`, infinite scroll нет. Форму не меняем.
   * Дефолт 100 (не 20!): 20 обрезало бы обсуждение в UI. Порядок — старые
   * сверху, как было.
   */
  async getComments(postId: string, params: { page?: number; limit?: number } = {}) {
    const page = clampPage(params.page, 1);
    const limit = clampLimit(params.limit, PAGINATION_BULK_LIMIT);
    return this.prisma.comment.findMany({
      where: { postId },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, name: true } } },
      skip: (page - 1) * limit,
      take: limit,
    });
  }

  async updateComment(
    commentId: string,
    userId: string,
    userRole: string,
    text: string,
  ) {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
    });
    if (!comment) throw new NotFoundException('Комментарий не найден');
    if (comment.userId !== userId && userRole !== 'ADMIN') {
      throw new ForbiddenException('Редактировать можно только свои комментарии');
    }

    // M1: модерация на РЕДАКТИРОВАНИИ комментария. Обход был: написать
    // чистый комментарий → PATCH-ем заменить текст на телефон/ссылку.
    // entityType тот же, что в addComment ('comment').
    const moderation = await this.moderationService.moderate({
      text,
      entityType: 'comment',
      userId,
    });
    if (moderation.verdict === 'block') {
      throw new BadRequestException(moderation.reason);
    }

    const updated = await this.prisma.comment.update({
      where: { id: commentId },
      data: { text },
      include: { user: { select: { id: true, name: true } } },
    });
    await this.auditService.log({
      userId,
      action: 'comment_updated',
      entity: 'comment',
      entityId: commentId,
    });
    return updated;
  }

  async deleteComment(commentId: string, userId: string, userRole: string) {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
    });
    if (!comment) throw new NotFoundException('Комментарий не найден');
    if (comment.userId !== userId && userRole !== 'ADMIN') {
      throw new ForbiddenException('Удалять можно только свои комментарии');
    }
    await this.prisma.comment.delete({ where: { id: commentId } });
    await this.auditService.log({
      userId,
      action: 'comment_deleted',
      entity: 'comment',
      entityId: commentId,
    });
    return { deleted: true };
  }
}
