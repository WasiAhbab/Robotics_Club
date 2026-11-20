import { BadRequestException, Body, Controller, Get, Injectable, Module, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { SupabaseService } from '../supabase/supabase.service';
import { AuditService } from '../common/audit.service';
import { unwrap } from '../common/db';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';

class DonationDto {
  @IsString() @MinLength(3) @MaxLength(1000) description: string;
  @IsOptional() @IsString() item_name?: string;
  @IsOptional() @IsIn(['donation','lend']) contribution_type?: 'donation'|'lend';
  @IsOptional() @IsDateString() lending_until?: string;
  @IsOptional() @IsNumber() @Min(0) estimated_value?: number;
}
class AssessDto {
  @IsBoolean() accept: boolean;
  /** Optional override; default is 1 point per 1,000 of estimated value (min 1). */
  @IsOptional() @IsInt() @Min(0) @Max(500) points?: number;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(500) reason?: string;
}

@Injectable()
export class DonationsService {
  constructor(private sb: SupabaseService, private audit: AuditService) {}

  async create(user: AuthUser, dto: DonationDto) {
    const { data, error } = await this.sb.admin.from('donations').insert({ ...dto, donor_id: user.id }).select().single();
    const row = unwrap({ data, error });
    await this.audit.log(user.id, 'donation.submitted', 'donation', row!.id);
    return row;
  }
  async list(user: AuthUser) {
    let q = this.sb.admin.from('donations').select('*, donor:profiles!donations_donor_id_fkey(id,full_name)').order('created_at', { ascending: false });
    if (!['super_admin', 'admin', 'moderator', 'secretary'].includes(user.role)) q = q.eq('donor_id', user.id);
    return unwrap(await q);
  }
  async assess(user: AuthUser, id: string, dto: AssessDto) {
    if (!dto.accept && !dto.reason?.trim()) throw new BadRequestException('A reason is required when rejecting a contribution');
    unwrap(await this.sb.asUser(user.token).rpc('review_contribution',{target:id,approved:dto.accept,reason:dto.reason??null,points:dto.points??null}));
    return unwrap(await this.sb.admin.from('donations').select('*').eq('id',id).single());
  }
}

@Controller('donations')
class DonationsController {
  constructor(private svc: DonationsService) {}
  @Roles('member') @Post() create(@CurrentUser() u: AuthUser, @Body() dto: DonationDto) { return this.svc.create(u, dto); }
  @Get() list(@CurrentUser() u: AuthUser) { return this.svc.list(u); }
  @Roles('super_admin', 'admin', 'moderator', 'secretary') @Post(':id/assess')
  assess(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AssessDto) { return this.svc.assess(u, id, dto); }
}

@Module({ controllers: [DonationsController], providers: [DonationsService] })
export class DonationsModule {}
