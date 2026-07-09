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
import { CreatePostDto } from './dto/create-post.dto';
import { CreateAdDto } from './dto/create-ad.dto';

@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);
  constructor(
    private prisma: PrismaService,
    private settingsService: SettingsService,
    private paymentsService: PaymentsService,
  ) {}

  async create(authorId: string, dto: CreatePostDto) {
    return this.prisma.post.create({
      data: { ...dto, authorId },
    });
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
    await this.activatePost(order.id);
    return this.prisma.post.findUnique({
      where: { id: post.id },
      include: { order: true },
    });
  }

  async findAll() {
    const now = new Date();
    return this.prisma.post.findMany({
      where: {
        isHidden: false,
        OR: [
          { isAd: false },
          { isAd: true, isPinned: true, adExpireDate: { gte: now } },
        ],
      },
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
      include: {
        author: { select: { id: true, name: true } },
        adOwner: { select: { id: true, name: true } },
      },
    });
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

  async activatePost(orderId: string) {
    const post = await this.prisma.post.findUnique({ where: { orderId } });
    if (!post) return;
    const expireDate = new Date();
    expireDate.setDate(expireDate.getDate() + 7);
    await this.prisma.post.update({
      where: { id: post.id },
      data: { isPinned: true, adExpireDate: expireDate },
    });
    this.logger.log(
      `Post ${post.id} activated until ${expireDate.toISOString()}`,
    );
  }

  async getFeed(userId?: string) {
    const posts = await this.prisma.post.findMany({
      where: {
        isHidden: false,
        OR: [
          { isAd: false },
          { isAd: true, isPinned: true, adExpireDate: { gte: new Date() } },
        ],
      },
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
      include: {
        author: { select: { id: true, name: true } },
        adOwner: { select: { id: true, name: true } },
        _count: { select: { likes: true, comments: true } },
        likes: userId ? { where: { userId }, take: 1 } : false,
      },
    });
    return posts.map((post) => ({
      ...post,
      likeCount: post._count?.likes ?? 0,
      commentCount: post._count?.comments ?? 0,
      likedByMe: userId ? post.likes?.length > 0 : false,
      likes: undefined,
      _count: undefined,
    }));
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
