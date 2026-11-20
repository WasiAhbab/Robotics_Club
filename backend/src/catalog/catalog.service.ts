import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { AuditService } from '../common/audit.service';
import { unwrap, unwrapOne } from '../common/db';
import { CategoryDto, ProductDto, UpdateCategoryDto, UpdateProductDto } from './catalog.dto';

@Injectable()
export class CatalogService {
  constructor(private sb: SupabaseService, private audit: AuditService) {}

  categories() {
    return this.sb.admin.from('categories').select('*').order('name').then(unwrap);
  }
  async createCategory(actor: string, dto: CategoryDto) {
    const row = unwrapOne(await this.sb.admin.from('categories').insert(dto).select().single());
    await this.audit.log(actor, 'category.created', 'category', row.id, null, row);
    return row;
  }
  async updateCategory(actor: string, id: string, dto: UpdateCategoryDto) {
    const row = unwrapOne(await this.sb.admin.from('categories').update(dto).eq('id', id).select().maybeSingle(), 'Category');
    await this.audit.log(actor, 'category.updated', 'category', id, null, dto);
    return row;
  }
  async deleteCategory(actor: string, id: string) {
    unwrap(await this.sb.admin.from('categories').delete().eq('id', id));
    await this.audit.log(actor, 'category.deleted', 'category', id);
    return { deleted: true };
  }

  /** Products with live stock counts derived from physical units. */
  async products(includeInactive = false): Promise<any[]> {
    let q = this.sb.admin.from('products').select('*, category:categories(id,name)').order('name');
    if (!includeInactive) q = q.eq('is_active', true);
    const products = unwrap(await q) ?? [];
    const units = unwrap(await this.sb.admin.from('inventory_units').select('product_id,status')) ?? [];
    const stock = new Map<string, { total: number; available: number }>();
    for (const u of units) {
      if (u.status === 'retired' || u.status === 'lost') continue;
      const s = stock.get(u.product_id) ?? { total: 0, available: 0 };
      s.total++;
      if (u.status === 'available') s.available++;
      stock.set(u.product_id, s);
    }
    return products.map((p: any) => ({ ...p, ...(stock.get(p.id) ?? { total: 0, available: 0 }) }));
  }
  async product(id: string) {
    const p = unwrapOne(await this.sb.admin.from('products').select('*, category:categories(id,name)').eq('id', id).maybeSingle(), 'Product');
    const all = await this.products(true);
    return all.find((x: any) => x.id === p.id) ?? p;
  }
  async createProduct(actor: string, dto: ProductDto) {
    const row = unwrapOne(await this.sb.admin.from('products').insert(dto).select().single());
    await this.audit.log(actor, 'product.created', 'product', row.id, null, row);
    return row;
  }
  async updateProduct(actor: string, id: string, dto: UpdateProductDto) {
    const row = unwrapOne(
      await this.sb.admin.from('products').update({ ...dto, updated_at: new Date().toISOString() }).eq('id', id).select().maybeSingle(),
      'Product',
    );
    await this.audit.log(actor, 'product.updated', 'product', id, null, dto);
    return row;
  }
  /** Soft delete: products are referenced by loan history. */
  async archiveProduct(actor: string, id: string) {
    await this.updateProduct(actor, id, { is_active: false });
    return { archived: true };
  }
}
