import { Global, Injectable, Module } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class AuditService {
  constructor(private sb: SupabaseService) {}

  /** Best-effort audit write; never blocks the main action. */
  async log(actorId: string, action: string, entityType: string, entityId?: string, before?: unknown, after?: unknown) {
    const { error } = await this.sb.admin.from('audit_logs').insert({
      actor_id: actorId, action, entity_type: entityType, entity_id: entityId ?? null,
      before_data: before ?? null, after_data: after ?? null,
    });
    if (error) console.error('[audit]', error.message);
  }

  async notify(recipientId: string, title: string, body: string, actorId?: string) {
    const { error } = await this.sb.admin.from('notifications').insert({ recipient_id: recipientId, actor_id: actorId ?? null, title, body });
    if (error) console.error('[notify]', error.message);
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
