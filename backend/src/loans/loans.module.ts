import { Body, Controller, Get, Injectable, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { SupabaseService } from '../supabase/supabase.service';
import { AuditService } from '../common/audit.service';
import { unwrap, unwrapOne } from '../common/db';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';

const CONDITIONS = ['excellent', 'good', 'fair', 'repairable', 'damaged', 'unusable'];
const STAFF = ['super_admin', 'admin', 'moderator', 'secretary'];
const SELECT = `*, borrower:profiles!loans_borrower_id_fkey(id,full_name,team_name),
  items:loan_items(*, unit:inventory_units(id,asset_tag,product:products(id,name,sku)))`;

class ReturnItemDto {
  @IsUUID() loan_item_id: string;
  @IsOptional() @IsIn(CONDITIONS) condition?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
class ReturnDto {
  /** Omit to return every outstanding item in its issued condition. */
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ReturnItemDto) items?: ReturnItemDto[];
}

@Injectable()
export class LoansService {
  constructor(private sb: SupabaseService, private audit: AuditService) {}

  async list(user: AuthUser, status?: string) {
    let q = this.sb.admin.from('loans').select(SELECT).order('issued_at', { ascending: false }).limit(300);
    if (!STAFF.includes(user.role)) q = q.eq('borrower_id', user.id);
    if (status) q = q.eq('status', status);
    return unwrap(await q);
  }
  async get(user: AuthUser, id: string) {
    let query = this.sb.admin.from('loans').select(SELECT).eq('id', id);
    if (!STAFF.includes(user.role)) query = query.eq('borrower_id', user.id);
    return unwrapOne(await query.maybeSingle(), 'Loan');
  }
  async returnLoan(user: AuthUser, id: string, dto: ReturnDto) {
    const status = unwrap(await this.sb.admin.rpc('return_loan', { p_loan: id, p_actor: user.id, p_items: dto.items ?? null }));
    return { status, loan: await this.get(user, id) };
  }
  async syncOverdue() {
    return { flagged: unwrap(await this.sb.admin.rpc('mark_overdue_loans')) as number };
  }

  @Cron(CronExpression.EVERY_HOUR)
  async cron() {
    try { await this.syncOverdue(); } catch (e) { console.error('[cron] overdue sync failed', e); }
  }
}

@Controller('loans')
class LoansController {
  constructor(private svc: LoansService) {}
  @Get() list(@CurrentUser() u: AuthUser, @Query('status') status?: string) { return this.svc.list(u, status); }
  @Roles('super_admin', 'admin','moderator', 'secretary') @Post('overdue/sync') sync() { return this.svc.syncOverdue(); }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.get(u, id); }
  @Roles('super_admin', 'admin','moderator', 'secretary') @Post(':id/return')
  ret(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReturnDto) { return this.svc.returnLoan(u, id, dto); }
}

@Module({ controllers: [LoansController], providers: [LoansService] })
export class LoansModule {}
