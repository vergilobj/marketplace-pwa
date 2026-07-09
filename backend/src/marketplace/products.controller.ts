import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  Request,
  Query,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Controller('products')
export class ProductsController {
  constructor(private productsService: ProductsService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SELLER')
  @Post()
  async create(@Request() req, @Body() dto: CreateProductDto) {
    return this.productsService.create(req.user.userId, dto);
  }

  @Get()
  async findAll() {
    return this.productsService.findAll();
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.productsService.findById(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SELLER')
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Request() req,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productsService.update(id, req.user.userId, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SELLER')
  @Delete(':id')
  async remove(@Param('id') id: string, @Request() req) {
    return this.productsService.remove(id, req.user.userId);
  }

  // Админские эндпоинты
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('admin/list')
  async findAllAdmin(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    return this.productsService.findAllAdmin({
      page: Number(page) || 1,
      limit: Number(limit) || 20,
      search,
      status,
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Patch(':id/toggle-active')
  async toggleActive(@Param('id') id: string) {
    return this.productsService.toggleActive(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Delete('admin/:id')
  async deleteProduct(@Param('id') id: string) {
    return this.productsService.deleteProduct(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Patch('admin/:id')
  async adminUpdate(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.productsService.adminUpdate(id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SELLER')
  @Get('my')
  async findMyProducts(@Request() req) {
    return this.productsService.findBySeller(req.user.userId);
  }
}
