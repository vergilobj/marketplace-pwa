import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
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
    return this.prisma.product.update({ where: { id }, data: { isActive: false } });
  }

  // Админские методы
  async findAllAdmin() {
    return this.prisma.product.findMany({
      include: { seller: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async toggleActive(id: string) {
    const product = await this.findById(id);
    return this.prisma.product.update({
      where: { id },
      data: { isActive: !product.isActive },
    });
  }

  async deleteProduct(id: string) {
    // Удаляем связанные заказы (order) для этого продукта? Заказы могут ссылаться на product, это вызовет ошибку.
    // Лучше заказы не удалять, а сохранять историю. Поэтому делаем soft-delete: деактивируем.
    // Но для админа нужна возможность полного удаления. Удалим заказы перед продуктом? Это опасно.
    // Поступим так: запретим удаление, если есть заказы. Или удалим все заказы. Выберем второй вариант.
    await this.prisma.order.deleteMany({ where: { productId: id } });
    return this.prisma.product.delete({ where: { id } });
  }
}