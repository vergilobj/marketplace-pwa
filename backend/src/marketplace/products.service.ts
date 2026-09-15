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

  /**
   * P1 (2026-09-15): удалённый товар (`isActive=false`) виден только владельцу
   * и ADMIN.
   *
   * Раньше метод не проверял `isActive` вообще (в отличие от `findAll`, где
   * `where: { isActive: true }`), поэтому `GET /products/:id` отдавал анониму
   * живой товар по прямой ссылке: название, цену, продавца и кнопку «Купить».
   * `POST /orders` такой товар уже отклонял — UI просто врал и вёл человека в
   * непонятную ошибку, а продавец терял контроль над тем, что считал удалённым.
   *
   * Отвечаем 404, а не 403 — не подтверждаем существование товара
   * (та же политика, что в `PostsService.findById`, коммент G3).
   *
   * Внутренние вызовы (`update`/`remove`/`toggleActive`) передают userId/role
   * явно — они уже авторизованы своим способом (см. места вызова).
   */
  async findById(id: string, userId?: string, role?: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { seller: { select: { id: true, name: true } } },
    });
    if (!product) throw new NotFoundException('Товар не найден');

    const isOwner = !!userId && product.sellerId === userId;
    const isAdmin = role === 'ADMIN';
    if (product.isActive === false && !isOwner && !isAdmin) {
      throw new NotFoundException('Товар не найден');
    }

    return product;
  }

  /**
   * P1: тот же фильтр видимости, что в `findById`.
   *
   * `findSimilar` — второй путь чтения товара по id. Сам удалённый товар он не
   * возвращает (в выборке `isActive: true`), но для несуществующего id отдаёт
   * `[]`, а для удалённого с «соседями» — непустой список. Это оракул
   * существования: `GET /products/<id>/similar` подтверждал бы, что товар был,
   * ровно то, что мы закрываем 404-кой. Поэтому для не-владельца удалённый
   * товар ведёт себя как несуществующий (пустой список).
   * Публичное поведение АКТИВНЫХ товаров не меняется.
   */
  async findSimilar(id: string, userId?: string, role?: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      select: { sellerId: true, title: true, isActive: true },
    });
    if (!product) return [];

    const isOwner = !!userId && product.sellerId === userId;
    const isAdmin = role === 'ADMIN';
    if (product.isActive === false && !isOwner && !isAdmin) return [];

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
    // P1: НЕ this.findById() — тот с 2026-09-15 скрывает удалённый товар от
    // не-владельца (404) и сломал бы этот ForbiddenException-путь.
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Товар не найден');
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
    // P1: как и в update — прямой findUnique, чтобы владелец мог повторно
    // удалить уже удалённый товар (иначе findById отдал бы 404 только владельцу
    // при другом userId... но контракт ForbiddenException важнее сохранить).
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Товар не найден');
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
    // P1: admin-роут (`@Roles('ADMIN')`) обязан уметь вернуть в каталог
    // УДАЛЁННЫЙ товар. Через this.findById() без userId/role это стало бы
    // невозможно (404 на isActive=false) — поэтому читаем напрямую.
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Товар не найден');
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
