import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { AuditService } from '../common/audit.service';
import { unwrap, unwrapOne } from '../common/db';
import { MaintenanceDto, UnitDto, UpdateMaintenanceDto, UpdateUnitDto } from './inventory.dto';

@Injectable()
export class InventoryService {
  constructor(private sb: SupabaseService, private audit: AuditService) {}

  async units(productId?: string, status?: string) {
    let q = this.sb.admin.from('inventory_units').select('*, product:products(id,name,sku)').order('asset_tag');
    if (productId) q = q.eq('product_id', productId);
    if (status) q = q.eq('status', status);
    return unwrap(await q);
  }
  async createUnit(actor: string, dto: UnitDto) {
    const row = unwrapOne(await this.sb.admin.from('inventory_units').insert(dto).select().single());
    unwrap(await this.sb.admin.from('inventory_movements').insert({
      inventory_unit_id: row.id, movement_type: 'created', to_status: 'available', performed_by: actor,
    }));
    await this.audit.log(actor, 'unit.created', 'inventory_unit', row.id, null, row);
    return row;
  }
  async updateUnit(actor: string, id: string, dto: UpdateUnitDto) {
    const before = unwrapOne(await this.sb.admin.from('inventory_units').select('*').eq('id', id).maybeSingle(), 'Unit');
    if (before.status === 'on_loan') throw new ConflictException('Unit is on loan; process the return first');
    if (!Object.keys(dto).length) throw new BadRequestException('Nothing to update');
    const row = unwrapOne(await this.sb.admin.from('inventory_units').update(dto).eq('id', id).select().single());
    if (dto.status && dto.status !== before.status) {
      unwrap(await this.sb.admin.from('inventory_movements').insert({
        inventory_unit_id: id, movement_type: 'status_change', from_status: before.status, to_status: dto.status, performed_by: actor,
      }));
    }
    await this.audit.log(actor, 'unit.updated', 'inventory_unit', id, before, row);
    return row;
  }

  async maintenance(status?: string) {
    let q = this.sb.admin.from('maintenance_records').select('*, unit:inventory_units(id,asset_tag,product:products(name))').order('opened_at', { ascending: false });
    if (status) q = q.eq('status', status);
    return unwrap(await q);
  }
  async openMaintenance(actor: string, dto: MaintenanceDto) {
    const unit = unwrapOne(await this.sb.admin.from('inventory_units').select('id,status').eq('id', dto.inventory_unit_id).maybeSingle(), 'Unit');
    if (unit.status === 'on_loan') throw new ConflictException('Unit is on loan; record damage during the return');
    const row = unwrapOne(await this.sb.admin.from('maintenance_records').insert({ ...dto, reported_by: actor }).select().single());
    unwrap(await this.sb.admin.from('inventory_units').update({ status: 'maintenance' }).eq('id', unit.id));
    await this.audit.log(actor, 'maintenance.opened', 'maintenance_record', row.id, null, row);
    return row;
  }
  async updateMaintenance(actor: string, id: string, dto: UpdateMaintenanceDto) {
    const done = dto.status === 'resolved' || dto.status === 'written_off';
    const row = unwrapOne(
      await this.sb.admin.from('maintenance_records')
        .update({ ...dto, resolved_at: done ? new Date().toISOString() : null }).eq('id', id).select().maybeSingle(),
      'Maintenance record',
    );
    if (done) {
      const next = dto.status === 'resolved' ? 'available' : 'retired';
      unwrap(await this.sb.admin.from('inventory_units').update({ status: next }).eq('id', row.inventory_unit_id));
      unwrap(await this.sb.admin.from('inventory_movements').insert({
        inventory_unit_id: row.inventory_unit_id, movement_type: 'maintenance_closed', from_status: 'maintenance', to_status: next, performed_by: actor,
      }));
    }
    await this.audit.log(actor, 'maintenance.updated', 'maintenance_record', id, null, dto);
    return row;
  }
  async movements(unitId?: string) {
    let q = this.sb.admin.from('inventory_movements').select('*').order('created_at', { ascending: false }).limit(200);
    if (unitId) q = q.eq('inventory_unit_id', unitId);
    return unwrap(await q);
  }
}
