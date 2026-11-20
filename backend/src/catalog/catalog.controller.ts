import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { CategoryDto, ProductDto, UpdateCategoryDto, UpdateProductDto } from './catalog.dto';
import { CurrentUser, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';

@Controller()
export class CatalogController {
  constructor(private svc: CatalogService) {}

  @Get('categories') categories() { return this.svc.categories(); }
  @Roles('super_admin', 'admin', 'moderator') @Post('categories')
  createCategory(@CurrentUser() u: AuthUser, @Body() dto: CategoryDto) { return this.svc.createCategory(u.id, dto); }
  @Roles('super_admin', 'admin', 'moderator') @Patch('categories/:id')
  updateCategory(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto) { return this.svc.updateCategory(u.id, id, dto); }
  @Roles('super_admin', 'admin', 'moderator') @Delete('categories/:id')
  deleteCategory(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.deleteCategory(u.id, id); }

  @Get('products')
  products(@CurrentUser() u: AuthUser, @Query('includeInactive') inc?: string) {
    return this.svc.products(inc === 'true' && ['super_admin', 'admin', 'moderator'].includes(u.role));
  }
  @Get('products/:id') product(@Param('id', ParseUUIDPipe) id: string) { return this.svc.product(id); }
  @Roles('super_admin', 'admin', 'moderator') @Post('products')
  createProduct(@CurrentUser() u: AuthUser, @Body() dto: ProductDto) { return this.svc.createProduct(u.id, dto); }
  @Roles('super_admin', 'admin', 'moderator') @Patch('products/:id')
  updateProduct(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto) { return this.svc.updateProduct(u.id, id, dto); }
  @Roles('super_admin', 'admin', 'moderator') @Delete('products/:id')
  archiveProduct(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.archiveProduct(u.id, id); }
}
