import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
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
      data: {
        ...dto,
        authorId,
      },
    });
  }

  async createAd(sellerId: string, dto: CreateAdDto) {
    // Получаем стоимость за день и общую сумму
    const adPricePerDay = await this.settingsService.getFloat('ad_price') || 5000;
    const totalAmount = adPricePerDay * dto.days;

    // Создаём пост в неактивном состоянии (isPinned=false пока не оплачен? По ТЗ пост помечается «Реклама» и закрепляется вверху после оплаты и до истечения срока.
    // Сначала создадим пост с isAd=true, adOwnerId=sellerId, adExpireDate позже, не показываем.
    const post = await this.prisma.post.create({
      data: {
        title: dto.title,
        content: dto.content,
        link: dto.link,
        authorId: sellerId,
        isAd: true,
        adOwnerId: sellerId,
        // срок будет установлен после оплаты
        isPinned: false,
      },
    });

    // Найти администратора (получателя платы за рекламу)
    const platformUser = await this.prisma.user.findFirst({ where: { role: 'ADMIN' } });
    if (!platformUser) throw new BadRequestException('Platform admin not found');

    // Создаём заказ на оплату рекламы (без товара, productId=null)
    const order = await this.prisma.order.create({
    data: {
        buyerId: sellerId, // продавец оплачивает
        sellerId: platformUser.id, // деньги идут платформе (админу)
        productId: null,
        amount: totalAmount,
        status: 'PENDING',
        referralUserId: null,
        referralBonus: 0,
        platformFee: totalAmount, // все средства – платформе
    },
    });

    // Связываем пост с заказом
    await this.prisma.post.update({
      where: { id: post.id },
      data: { orderId: order.id },
    });

    // Инициируем платёж (через заглушку)
    await this.paymentsService.createPaymentForOrder(order.id);
    await this.paymentsService.processSuccessfulPayment(order.id); // автоматическое подтверждение в тесте

    await this.activatePost(order.id);

    // После оплаты активируем пост (в processSuccessfulPayment мы добавим активацию)
    return this.prisma.post.findUnique({ where: { id: post.id }, include: { order: true } });
  }

  async findAll(onlyVisible = true) {
    const now = new Date();
    return this.prisma.post.findMany({
      where: {
        OR: [
          { isAd: false }, // обычные посты
          { isAd: true, isPinned: true, adExpireDate: { gte: now } }, // активная реклама
        ],
      },
      orderBy: [
        { isPinned: 'desc' }, // закреплённые вверху
        { createdAt: 'desc' },
      ],
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

  async activatePost(orderId: string) {
    // Вызывается после успешной оплаты заказа, связанного с постом
    const post = await this.prisma.post.findUnique({ where: { orderId } });
    if (!post) return;

    const durationDays = await this.settingsService.getFloat('ad_duration_days') || 7; // по умолчанию 7 дней
    const expireDate = new Date();
    expireDate.setDate(expireDate.getDate() + durationDays);

    await this.prisma.post.update({
      where: { id: post.id },
      data: {
        isPinned: true,
        adExpireDate: expireDate,
      },
    });
    this.logger.log(`Post ${post.id} activated until ${expireDate}`);
  }

  async delete(id: string) {
    return this.prisma.post.delete({ where: { id } });
  }

  async getFeed(userId?: string) {
    const posts = await this.prisma.post.findMany({
      where: {
        OR: [
          { isAd: false },
          { isAd: true, isPinned: true, adExpireDate: { gte: new Date() } },
        ],
      },
      orderBy: [
        { isPinned: 'desc' },
        { createdAt: 'desc' },
      ],
      include: {
        author: { select: { id: true, name: true } },
        adOwner: { select: { id: true, name: true } },
        _count: { select: { likes: true, comments: true } },
        likes: userId ? { where: { userId }, take: 1 } : false,
      },
    });
  
    // Трансформируем для фронтенда
    return posts.map(post => ({
      ...post,
      likeCount: post._count?.likes ?? 0,
      commentCount: post._count?.comments ?? 0,
      likedByMe: userId ? post.likes?.length > 0 : false,
      likes: undefined,
      _count: undefined,
    }));
  }
}