import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { AuditService } from '../common/audit.service';
import { unwrap } from '../common/db';
import { DEFAULT_PREFS, Preferences, PreferencesDto } from './settings.dto';

@Injectable()
export class SettingsService {
  constructor(private sb: SupabaseService, private audit: AuditService) {}

  async preferences(): Promise<Preferences> {
    const row = unwrap(await this.sb.admin.from('club_settings').select('value').eq('key', 'preferences').maybeSingle());
    return { ...DEFAULT_PREFS, ...(row?.value ?? {}) };
  }
  async update(actor: string, dto: PreferencesDto) {
    const before = await this.preferences();
    const next = { ...before, ...Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)) };
    unwrap(await this.sb.admin.from('club_settings').upsert({ key: 'preferences', value: next, updated_by: actor, updated_at: new Date().toISOString() }));
    await this.audit.log(actor, 'settings.updated', 'club_settings', undefined, before, next);
    return next;
  }
  async auditLogs(limit = 100) {
    return unwrap(
      await this.sb.admin.from('audit_logs')
        .select('*, actor:profiles!audit_logs_actor_id_fkey(id,full_name)')
        .order('created_at', { ascending: false }).limit(Math.min(Math.max(limit, 1), 500)),
    );
  }
}
