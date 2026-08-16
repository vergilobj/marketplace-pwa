import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { PaymentsService } from '../payments/payments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreatePostDto } from './dto/create-post.dto';
import { CreateAdDto } from './dto/create-ad.dto';

@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);
  constructor(
    private prisma: PrismaService,
    private settingsService: SettingsService,
    private paymentsService: PaymentsService,
    private notificationsService: NotificationsService,
  ) {}

  async create(authorId: string, dto: CreatePostDto) {
    const post = await this.prisma.post.create({
      data: { ...dto, authorId },
    });

    // Notify all users about new post
    try {
      const users = await this.prisma.user.findMany({
        select: { id: true },
        where: { isApproved: true },
      });
      for (const user of users) {
        await this.notificationsService
          .createNotification(
            user.id,
            'post',
            `Новый пост: ${post.title}`,
            post.id,
          )
          .catch(() => {}); // fire-and-forget per user
      }
    } catch (e) {
      this.logger.warn('Failed to send post notifications', e);
    }

    return post;
  }

  async createAd(sellerId: string, dto: CreateAdDto) {
    const adPricePerDay =
      (await this.settingsService.getFloat('ad_price')) || 5000;
    const totalAmount = adPricePerDay * dto.days;
    const post = await this.prisma.post.create({
      data: {
        title: dto.title,
        content: dto.content,
        link: dto.link,
        authorId: sellerId,
        isAd: true,
        adOwnerId: sellerId,
        isPinned: false,
      },
    });
    const platformUser = await this.prisma.user.findFirst({
      where: { role: 'ADMIN' },
    });
    if (!platformUser)
      throw new BadRequestException('Platform admin not found');
    const order = await this.prisma.order.create({
      data: {
        buyerId: sellerId,
        sellerId: platformUser.id,
        productId: null,
        amount: totalAmount,
        status: 'PENDING',
        referralUserId: null,
        referralBonus: 0,
        platformFee: totalAmount,
      },
    });
    await this.prisma.post.update({
      where: { id: post.id },
      data: { orderId: order.id },
    });
    await this.paymentsService.createPaymentForOrder(order.id);
    await this.paymentsService.processSuccessfulPayment(order.id);
    await this.activatePost(order.id, dto.days);
    return this.prisma.post.findUnique({
      where: { id: post.id },
      include: { order: true },
    });
  }

  async findAll(params: { page?: number; limit?: number; sort?: string }) {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const skip = (page - 1) * limit;
    const now = new Date();

    const orderBy: any[] = [];
    switch (params.sort) {
      case 'popular':
        orderBy.push({ likes: { _count: 'desc' } });
        break;
      case 'newest':
      default:
        orderBy.push({ isPinned: 'desc' }, { createdAt: 'desc' });
        break;
    }

    const where = {
      isHidden: false,
      OR: [
        { isAd: false },
        { isAd: true, isPinned: true, adExpireDate: { gte: now } },
      ],
    };

    const [items, total] = await Promise.all([
      this.prisma.post.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          author: { select: { id: true, name: true } },
          adOwner: { select: { id: true, name: true } },
          _count: { select: { likes: true, comments: true } },
        },
      }),
      this.prisma.post.count({ where }),
    ]);

    return {
      items: items.map((post) => ({
        ...post,
        likeCount: post._count?.likes ?? 0,
        commentCount: post._count?.comments ?? 0,
        media: post.media || [],
        _count: undefined,
      })),
      total,
      page,
      pages: Math.ceil(total / limit),
    };
  }

  async findById(id: string) {
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('Post not found');
    return post;
  }

  async delete(id: string) {
    await this.prisma.like.deleteMany({ where: { postId: id } });
    await this.prisma.comment.deleteMany({ where: { postId: id } });
    return this.prisma.post.delete({ where: { id } });
  }

  async activatePost(orderId: string, days: number = 7) {
    const post = await this.prisma.post.findUnique({ where: { orderId } });
    if (!post) return;
    const expireDate = new Date();
    expireDate.setDate(expireDate.getDate() + days);
    await this.prisma.post.update({
      where: { id: post.id },
      data: { isPinned: true, adExpireDate: expireDate },
    });
    this.logger.log(
      `Post ${post.id} activated until ${expireDate.toISOString()}`,
    );
  }

  async getFeed(params: {
    userId?: string;
    page?: number;
    limit?: number;
    sort?: string;
  }) {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const skip = (page - 1) * limit;
    const { userId, sort } = params;

    const now = new Date();

    const orderBy: any[] = [];
    switch (sort) {
      case 'popular':
        orderBy.push({ likes: { _count: 'desc' } });
        break;
      case 'newest':
      default:
        orderBy.push({ isPinned: 'desc' }, { createdAt: 'desc' });
        break;
    }

    const where = {
      isHidden: false,
      OR: [
        { isAd: false },
        { isAd: true, isPinned: true, adExpireDate: { gte: now } },
      ],
    };

    const [items, total] = await Promise.all([
      this.prisma.post.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          author: { select: { id: true, name: true } },
          adOwner: { select: { id: true, name: true } },
          _count: { select: { likes: true, comments: true } },
          likes: userId ? { where: { userId }, take: 1 } : false,
        },
      }),
      this.prisma.post.count({ where }),
    ]);

    return {
      items: items.map((post) => ({
        ...post,
        likeCount: post._count?.likes ?? 0,
        commentCount: post._count?.comments ?? 0,
        likedByMe: userId ? post.likes?.length > 0 : false,
        media: post.media || [],
        likes: undefined,
        _count: undefined,
      })),
      total,
      page,
      pages: Math.ceil(total / limit),
    };
  }

  // Админские методы
  async findAllAdmin(params: {
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
  }) {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const skip = (page - 1) * limit;
    const where: any = {};
    if (params.search) {
      where.OR = [
        { title: { contains: params.search, mode: 'insensitive' } },
        { content: { contains: params.search, mode: 'insensitive' } },
      ];
    }
    if (params.status === 'hidden') where.isHidden = true;
    else if (params.status === 'visible') where.isHidden = false;

    const [items, total] = await Promise.all([
      this.prisma.post.findMany({
        where,
        include: {
          author: { select: { id: true, name: true } },
          adOwner: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.post.count({ where }),
    ]);
    return { items, total, page, pages: Math.ceil(total / limit) };
  }

  async toggleVisibility(id: string) {
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('Post not found');
    return this.prisma.post.update({
      where: { id },
      data: { isHidden: !post.isHidden },
    });
  }

  async update(
    id: string,
    userId: string,
    userRole: string,
    data: {
      title?: string;
      content?: string;
      link?: string;
      media?: string[];
      videoUrl?: string;
    },
  ) {
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('Post not found');

    // Разрешить редактирование только автору или админу
    if (post.authorId !== userId && userRole !== 'ADMIN') {
      throw new ForbiddenException('You can only edit your own posts');
    }

    return this.prisma.post.update({
      where: { id },
      data,
    });
  }
}
