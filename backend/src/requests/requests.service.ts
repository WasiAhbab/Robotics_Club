import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { AuditService } from '../common/audit.service';
import { SettingsService } from '../settings/settings.service';
import { unwrap, unwrapOne } from '../common/db';
import { AuthUser } from '../auth/auth.types';
import { CreateRequestDto } from './requests.dto';

const SELECT = `*, requester:profiles!borrow_requests_requester_id_fkey(id,full_name,team_name,reputation_score),
  items:request_items(id,quantity,product:products(id,name,sku)), participants:request_participants(member_id,is_leader)`;
const STAFF = ['super_admin', 'admin', 'moderator', 'secretary'];

@Injectable()
export class RequestsService {
  constructor(private sb: SupabaseService, private audit: AuditService, private settings: SettingsService) {}

  private ymd(d: Date) { return d.toISOString().slice(0, 10); }

  async create(user: AuthUser, dto: CreateRequestDto) {
    const prefs = await this.settings.preferences();
    const due = dto.requested_due_date ?? this.ymd(new Date(Date.now() + prefs.borrowDays * 864e5));
    if (due < this.ymd(new Date())) throw new BadRequestException('Due date cannot be in the past');
    const maxDue = this.ymd(new Date(Date.now() + 90 * 864e5));
    if (due > maxDue) throw new BadRequestException('Due date is too far in the future');
    const productIds = dto.items.map((i) => i.product_id);
    if (new Set(productIds).size !== productIds.length) throw new BadRequestException('Duplicate products in request');
    if (dto.is_group_request && !dto.group_name) throw new BadRequestException('group_name is required for group requests');
    const participants = (dto.participant_ids ?? []).filter((id) => id !== user.id);

    const id = unwrap(
      await this.sb.admin.rpc('create_borrow_request', {
        p_requester: user.id, p_group_name: dto.group_name ?? null, p_is_group: dto.is_group_request ?? false,
        p_project: dto.project_name, p_competition: dto.competition_date ?? null, p_purpose: dto.purpose,
        p_due: due, p_items: dto.items, p_participants: participants,
      }),
    ) as string;
    await this.audit.log(user.id, 'request.created', 'borrow_request', id);
    return this.get(user, id);
  }

  async list(user: AuthUser, status?: string) {
    let q = this.sb.admin.from('borrow_requests').select(SELECT).order('created_at', { ascending: false }).limit(300);
    const staff = STAFF.includes(user.role);
    if (!staff) q = q.eq('requester_id', user.id);
    if (status) q = q.eq('status', status);
    const rows: any[] = unwrap(await q) ?? [];
    if (!staff) return rows;
    // Priority = reputation + deadline urgency. Advisory only: staff still decide manually.
    const withPriority = rows.map((r: any) => ({ ...r, priority: this.priority(r) }));
    return status === 'pending' ? withPriority.sort((a: any, b: any) => b.priority - a.priority) : withPriority;
  }

  private priority(r: any): number {
    const rep = Math.max(-50, Math.min(100, r.requester?.reputation_score ?? 0));
    let urgency = 0;
    if (r.competition_date) {
      const days = Math.ceil((Date.parse(r.competition_date) - Date.now()) / 864e5);
      urgency += days <= 7 ? 30 : days <= 14 ? 15 : 5;
    }
    return rep + urgency;
  }

  async get(user: AuthUser, id: string) {
    let query = this.sb.admin.from('borrow_requests').select(SELECT).eq('id', id);
    if (!STAFF.includes(user.role)) query = query.eq('requester_id', user.id);
    return unwrapOne(await query.maybeSingle(), 'Request');
  }

  async cancel(user: AuthUser, id: string) {
    const row = await this.get(user, id);
    if (row.requester_id !== user.id) throw new ForbiddenException('Only the requester can cancel');
    const res = await this.sb.admin.from('borrow_requests').update({ status: 'cancelled' }).eq('id', id).eq('status', 'pending').select().maybeSingle();
    if (!unwrap(res)) throw new ConflictException('Only pending requests can be cancelled');
    await this.audit.log(user.id, 'request.cancelled', 'borrow_request', id);
    return { cancelled: true };
  }

  /** Atomic: allocates physical units and opens the loan inside one DB transaction. */
  async approve(user: AuthUser, id: string, note?: string) {
    const loanId = unwrap(await this.sb.admin.rpc('approve_request', { p_request: id, p_reviewer: user.id, p_note: note ?? null })) as string;
    return { approved: true, loan_id: loanId };
  }

  async reject(user: AuthUser, id: string, note?: string) {
    unwrap(await this.sb.asUser(user.token).rpc('review_request',{target:id,approved:false,reason:note}));
    return {rejected:true};
  }
}
