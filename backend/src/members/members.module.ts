import { BadRequestException, Body, Controller, Get, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, Query, ForbiddenException } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, MinLength, IsUUID, Max, Min, IsDateString } from 'class-validator';
import { SupabaseService } from '../supabase/supabase.service';
import { AuditService } from '../common/audit.service';
import { unwrap, unwrapOne } from '../common/db';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';

const STAFF = ['super_admin', 'admin', 'moderator'];
const COLS = 'id,full_name,student_id,department,team_name,role,reputation_score,is_active,academic_level,membership_status,created_at';

class UpdateMeDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100) full_name?: string;
  @IsOptional() @IsString() @MaxLength(40) student_id?: string;
  @IsOptional() @IsString() @MaxLength(80) department?: string;
  @IsOptional() @IsString() @MaxLength(80) team_name?: string;
  @IsOptional() @IsString() @MaxLength(80) academic_level?: string;
}
class AchievementDto {
  @IsString() @MinLength(3) @MaxLength(160) title: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsIn(['project','competition','publication','certification']) achievement_type: 'project'|'competition'|'publication'|'certification';
  @IsOptional() @IsDateString() achieved_at?: string;
}
class MemberStatusDto {
  @IsIn(['active','suspended','banned']) membership_status: 'active'|'suspended'|'banned';
  @IsOptional() @IsInt() @Min(1) @Max(365) suspension_days?: number;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(500) reason?: string;
}
class AdjustDto {
  @IsUUID() member_id: string;
  @IsInt() @Min(-500) @Max(500) delta: number;
  @IsString() @MinLength(3) @MaxLength(300) reason: string;
}

@Injectable()
export class MembersService {
  constructor(private sb: SupabaseService, private audit: AuditService) {}

  async list(search?: string) {
    let q = this.sb.admin.from('profiles').select(COLS).order('reputation_score', { ascending: false }).order('full_name');
    if (search) q = q.ilike('full_name', `%${search.replace(/[%_,()]/g, '')}%`);
    return unwrap(await q);
  }
  async directory() { return unwrap(await this.sb.admin.from('member_directory').select('*').order('reputation_score', { ascending: false }).order('full_name')); }
  async publicProfile(user: AuthUser, id: string) {
    const member = unwrapOne(await this.sb.admin.from('member_directory').select('*').eq('id', id).maybeSingle(), 'Member');
    let offers = this.sb.admin.from('donations').select('id,item_name,description,contribution_type,status,lending_until,created_at,reputation_awarded').eq('donor_id', id).eq('status','accepted').order('created_at',{ascending:false});
    if (user.role === 'member' && user.id !== id) offers = offers.eq('contribution_type', 'donation');
    const contributions = unwrap(await offers);
    const achievements = unwrap(await this.sb.admin.from('member_achievements').select('id,title,description,achievement_type,achieved_at').eq('member_id',id).eq('is_verified',true).order('achieved_at',{ascending:false}));
    return { ...member, contributions, achievements };
  }
  async get(user: AuthUser, id: string) {
    if (!STAFF.includes(user.role) && user.id !== id) throw new ForbiddenException();
    return unwrapOne(await this.sb.admin.from('profiles').select(COLS).eq('id', id).maybeSingle(), 'Member');
  }
  async updateMe(user: AuthUser, dto: UpdateMeDto) {
    if (!Object.keys(dto).length) throw new BadRequestException('Nothing to update');
    return unwrapOne(await this.sb.admin.from('profiles').update({ ...dto, updated_at: new Date().toISOString() }).eq('id', user.id).select(COLS).single());
  }
  async adminUpdate(user: AuthUser, id: string, dto: UpdateMeDto) {
    const before = unwrapOne(await this.sb.admin.from('profiles').select(COLS).eq('id', id).maybeSingle(), 'Member');
    if (before.role === 'super_admin') throw new ForbiddenException('The Super Admin account can only be transferred through the owner process');
    if (before.role === 'admin' && user.role !== 'super_admin') throw new ForbiddenException('Only the Super Admin can manage Admin accounts');
    const row = unwrapOne(await this.sb.admin.from('profiles').update({ ...dto, updated_at: new Date().toISOString() }).eq('id', id).select(COLS).single());
    await this.audit.log(user.id, 'member.updated', 'profile', id, before, row);
    return row;
  }

  async addAchievement(user: AuthUser, id: string, dto: AchievementDto) {
    const row = unwrapOne(await this.sb.admin.from('member_achievements').insert({ member_id:id, title:dto.title, description:dto.description ?? null, achievement_type:dto.achievement_type, achieved_at:dto.achieved_at ?? null, is_verified:true, verified_by:user.id }).select().single());
    await this.audit.log(user.id, 'member.achievement.verified', 'member_achievement', row.id, null, row);
    return row;
  }

  async setStatus(user: AuthUser, id: string, dto: MemberStatusDto) {
    if (dto.membership_status !== 'active' && !dto.reason?.trim()) throw new BadRequestException('A reason is required for a kick or suspension');
    const action={active:'restore',suspended:'suspend',banned:'kick'}[dto.membership_status];
    unwrap(await this.sb.asUser(user.token).rpc('manage_member',{target:id,action,reason:dto.reason??null,days:dto.suspension_days??7}));
    return this.get(user,id);
  }

  async ledger(memberId: string) {
    return unwrap(await this.sb.admin.from('reputation_ledger')
      .select('*, actor:profiles!reputation_ledger_adjusted_by_fkey(id,full_name)').eq('member_id', memberId).order('created_at', { ascending: false }).limit(200));
  }
  async adjust(user: AuthUser, dto: AdjustDto) {
    const member = unwrapOne(await this.sb.admin.from('profiles').select('full_name').eq('id', dto.member_id).maybeSingle(), 'Member');
    const score = unwrap(await this.sb.admin.rpc('adjust_reputation', { p_member: dto.member_id, p_delta: dto.delta, p_reason: dto.reason, p_admin: user.id }));
    const signed = `${dto.delta > 0 ? '+' : ''}${dto.delta}`;
    await this.audit.notify(dto.member_id, 'Reputation updated', `Your reputation changed by ${signed} points. Reason: ${dto.reason}. Reviewed by ${user.fullName}.`, user.id);
    return { reputation_score: score, member_name: member.full_name };
  }
}

@Controller()
class MembersController {
  constructor(private svc: MembersService) {}
  @Get('me') me(@CurrentUser() u: AuthUser) { return this.svc.get(u, u.id); }
  @Patch('me') updateMe(@CurrentUser() u: AuthUser, @Body() dto: UpdateMeDto) { return this.svc.updateMe(u, dto); }
  @Roles('member','super_admin','admin','moderator') @Get('member-directory') directory() { return this.svc.directory(); }
  @Roles('member','super_admin','admin','moderator') @Get('members/:id/profile') profile(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.publicProfile(user, id); }
  @Roles('super_admin', 'admin', 'moderator') @Get('members') list(@Query('search') s?: string) { return this.svc.list(s); }
  @Get('members/:id') get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.get(u, id); }
  @Roles('super_admin', 'admin') @Patch('members/:id')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMeDto) { return this.svc.adminUpdate(u, id, dto); }

  @Roles('super_admin', 'admin', 'moderator') @Post('members/:id/achievements')
  achievement(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AchievementDto) { return this.svc.addAchievement(u, id, dto); }

  @Roles('super_admin', 'admin') @Patch('members/:id/status')
  setStatus(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MemberStatusDto) { return this.svc.setStatus(u, id, dto); }

  @Get('reputation/me') myLedger(@CurrentUser() u: AuthUser) { return this.svc.ledger(u.id); }
  @Roles('super_admin', 'admin') @Get('reputation/members/:id') ledger(@Param('id', ParseUUIDPipe) id: string) { return this.svc.ledger(id); }
  @Roles('super_admin', 'admin') @Post('reputation/adjust') adjust(@CurrentUser() u: AuthUser, @Body() dto: AdjustDto) { return this.svc.adjust(u, dto); }
}

@Module({ controllers: [MembersController], providers: [MembersService] })
export class MembersModule {}
