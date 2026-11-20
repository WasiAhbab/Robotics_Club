import { Controller, Get, Module, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { unwrap } from '../common/db';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';

@Controller('notifications')
class NotificationsController {
  constructor(private sb: SupabaseService) {}

  @Get() async list(@CurrentUser() u: AuthUser) {
    return unwrap(await this.sb.admin.from('notifications').select('*, actor:profiles!notifications_actor_id_fkey(id,full_name)').eq('recipient_id', u.id).order('created_at', { ascending: false }).limit(50));
  }
  @Post('read-all') async readAll(@CurrentUser() u: AuthUser) {
    unwrap(await this.sb.admin.from('notifications').update({ read_at: new Date().toISOString() }).eq('recipient_id', u.id).is('read_at', null));
    return { ok: true };
  }
  @Patch(':id/read') async read(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    unwrap(await this.sb.admin.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id).eq('recipient_id', u.id));
    return { ok: true };
  }
}

@Module({ controllers: [NotificationsController] })
export class NotificationsModule {}
