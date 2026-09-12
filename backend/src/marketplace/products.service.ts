import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ModerationService } from '../moderation/moderation.service';
import {
  PAGINATION_BULK_LIMIT,
  clampLimit,
  clampPage,
} from '../common/dto/pagination.dto';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private moderationService: ModerationService,
  ) {}

  async create(sellerId: string, dto: CreateProductDto) {
    const moderation = await this.moderationService.moderate({
      text: [dto.title, dto.description].filter(Boolean).join('\n'),
      entityType: 'product',
      userId: sellerId,
    });
    if (moderation.verdict === 'block') {
      throw new BadRequestException(moderation.reason);
    }

    const product = await this.prisma.product.create({
      data: { ...dto, sellerId },
    });
    await this.auditService.log({
      userId: sellerId,
      action: 'product_created',
      entity: 'product',
      entityId: product.id,
    });

    // Фича: товар автоматически попадает в ленту (пост-новость).
    // Модерация уже пройдена для товара — текст тот же, повторно не модерируем.
    // Не роняем создание товара, если пост не создался.
    try {
      await this.prisma.post.create({
        data: {
          title: product.title,
          content: product.description || null,
          authorId: sellerId,
          isAd: false,
          isHidden: false,
        },
      });
    } catch (e) {
      this.logger.warn(
        `Failed to auto-create feed post for product ${product.id}: ${(e as Error).message}`,
      );
    }

    return product;
  }

  async findAll(params: {
    page?: number;
    limit?: number;
    sort?: string;
    onlyActive?: boolean;
    search?: string;
  }) {
    // L1: жёсткий потолок limit (сервисный кламп — вторая линия защиты после
    // контроллера). Без него `?limit=100000` отдавал всю базу одним ответом.
    const page = clampPage(params.page, 1);
    const limit = clampLimit(params.limit, 20);
    const skip = (page - 1) * limit;
    const onlyActive = params.onlyActive !== false;

    const orderBy: Prisma.ProductOrderByWithRelationInput[] = [];
    switch (params.sort) {
      case 'price_asc':
        orderBy.push({ price: 'asc' });
        break;
      case 'price_desc':
        orderBy.push({ price: 'desc' });
        break;
      case 'popular':
        orderBy.push({ orders: { _count: 'desc' } });
        break;
      default:
        orderBy.push({ isAd: 'desc' });
        orderBy.push({ createdAt: 'desc' });
        break;
    }

    // R10: серверный поиск по названию и описанию — не ограничен страницей пагинации
    const search = params.search?.trim();
    const where: Prisma.ProductWhereInput = onlyActive
      ? { isActive: true }
      : {};
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: { seller: { select: { id: true, name: true } } },
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);
    return { items, total, page, pages: Math.ceil(total / limit) };
  }

  async findById(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { seller: { select: { id: true, name: true } } },
    });
    if (!product) throw new NotFoundException('Товар не найден');
    return product;
  }

  async findSimilar(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      select: { sellerId: true, title: true },
    });
    if (!product) return [];

    const firstWord = product.title.trim().split(/\s+/)[0];
    return this.prisma.product.findMany({
      where: {
        id: { not: id },
        isActive: true,
        OR: [
          { sellerId: product.sellerId },
          { title: { contains: firstWord } },
        ],
      },
      include: { seller: { select: { id: true, name: true } } },
      take: 4,
    });
  }

  async update(id: string, sellerId: string, dto: UpdateProductDto) {
    const product = await this.findById(id);
    if (product.sellerId !== sellerId) {
      throw new ForbiddenException('Редактировать можно только свои товары');
    }

    // M1: модерация на РЕДАКТИРОВАНИИ. Обход был: создать чистый товар →
    // PATCH-ем вписать телефон/ссылку в title/description.
    // Модерируем ИТОГОВЫЙ текст (merge dto + текущий товар): правка только
    // заголовка не должна оставлять старое описание вне проверки.
    // entityType тот же, что на создании ('product').
    const moderation = await this.moderationService.moderate({
      text: [dto.title ?? product.title, dto.description ?? product.description]
        .filter(Boolean)
        .join('\n'),
      entityType: 'product',
      userId: sellerId,
    });
    if (moderation.verdict === 'block') {
      throw new BadRequestException(moderation.reason);
    }

    const updated = await this.prisma.product.update({
      where: { id },
      data: dto,
    });
    await this.auditService.log({
      userId: sellerId,
      action: 'product_updated',
      entity: 'product',
      entityId: id,
    });
    return updated;
  }

  async remove(id: string, sellerId: string) {
    const product = await this.findById(id);
    if (product.sellerId !== sellerId) {
      throw new ForbiddenException('Деактивировать можно только свои товары');
    }
    const updated = await this.prisma.product.update({
      where: { id },
      data: { isActive: false },
    });
    await this.auditService.log({
      userId: sellerId,
      action: 'product_deleted',
      entity: 'product',
      entityId: id,
    });
    return updated;
  }

  // Админские методы
  async findAllAdmin(params: {
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
  }) {
    const page = clampPage(params.page, 1);
    const limit = clampLimit(params.limit, 20);
    const skip = (page - 1) * limit;
    const where: Prisma.ProductWhereInput = {};
    if (params.search) {
      where.OR = [
        { title: { contains: params.search, mode: 'insensitive' } },
        { description: { contains: params.search, mode: 'insensitive' } },
      ];
    }
    if (params.status === 'active') where.isActive = true;
    else if (params.status === 'hidden') where.isActive = false;

    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: { seller: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);
    return { items, total, page, pages: Math.ceil(total / limit) };
  }

  async toggleActive(id: string) {
    const product = await this.findById(id);
    const updated = await this.prisma.product.update({
      where: { id },
      data: { isActive: !product.isActive },
    });
    await this.auditService.log({
      action: 'product_toggled',
      entity: 'product',
      entityId: id,
    });
    return updated;
  }

  async deleteProduct(id: string) {
    const orders = await this.prisma.order.findMany({
      where: { productId: id },
      select: { id: true },
    });
    const orderIds = orders.map((o) => o.id);
    if (orderIds.length > 0) {
      await this.prisma.transaction.deleteMany({
        where: { orderId: { in: orderIds } },
      });
      await this.prisma.order.deleteMany({ where: { productId: id } });
    }
    const deleted = await this.prisma.product.delete({ where: { id } });
    await this.auditService.log({
      action: 'product_deleted',
      entity: 'product',
      entityId: id,
    });
    return deleted;
  }

  async adminUpdate(id: string, dto: UpdateProductDto) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Товар не найден');
    return this.prisma.product.update({
      where: { id },
      data: dto,
    });
  }

  /**
   * L1: «мои товары». Раньше `findMany` без `take` — активный продавец с
   * сотнями позиций отдавал всё одним ответом.
   *
   * ⚠️ Совместимость: фронт (`MyProductsPage`) читает ответ КАК МАССИВ
   * (`r.data || []`), infinite scroll тут нет. Поэтому форму ответа НЕ меняем —
   * это по-прежнему массив, просто ограниченный по длине. Дефолт 100: у
   * обычного продавца товаров меньше, а если больше — данные не теряются
   * навсегда, их доберёт страница пагинации (`page`), которую можно передать.
   */
  async findBySeller(
    sellerId: string,
    params: { page?: number; limit?: number } = {},
  ) {
    const page = clampPage(params.page, 1);
    const limit = clampLimit(params.limit, PAGINATION_BULK_LIMIT);
    return this.prisma.product.findMany({
      where: { sellerId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    });
  }
}
