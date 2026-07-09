import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  async create(sellerId: string, dto: CreateProductDto) {
    return this.prisma.product.create({
      data: { ...dto, sellerId },
    });
  }

  async findAll(onlyActive = true) {
    return this.prisma.product.findMany({
      where: onlyActive ? { isActive: true } : {},
      include: { seller: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { seller: { select: { id: true, name: true } } },
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async update(id: string, sellerId: string, dto: UpdateProductDto) {
    const product = await this.findById(id);
    if (product.sellerId !== sellerId) {
      throw new ForbiddenException('You can only edit your own products');
    }
    return this.prisma.product.update({ where: { id }, data: dto });
  }

  async remove(id: string, sellerId: string) {
    const product = await this.findById(id);
    if (product.sellerId !== sellerId) {
      throw new ForbiddenException('You can only deactivate your own products');
    }
    return this.prisma.product.update({
      where: { id },
      data: { isActive: false },
    });
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
    return this.prisma.product.update({
      where: { id },
      data: { isActive: !product.isActive },
    });
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
    return this.prisma.product.delete({ where: { id } });
  }

  async adminUpdate(id: string, dto: UpdateProductDto) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Product not found');
    return this.prisma.product.update({
      where: { id },
      data: dto,
    });
  }

  async findBySeller(sellerId: string) {
    return this.prisma.product.findMany({
      where: { sellerId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
