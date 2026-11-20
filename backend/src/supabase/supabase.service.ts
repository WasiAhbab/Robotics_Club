import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-side client using the service-role key. It bypasses RLS, so every
 * controller MUST enforce authorization (AuthGuard + RolesGuard + ownership checks).
 */
@Injectable()
export class SupabaseService {
  readonly admin: SupabaseClient;

  constructor(private config: ConfigService) {
    this.admin = createClient(
      config.getOrThrow<string>('SUPABASE_URL'),
      config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }

  asUser(token:string) {
    return createClient(this.config.getOrThrow<string>('SUPABASE_URL'),this.config.getOrThrow<string>('SUPABASE_ANON_KEY'),{global:{headers:{Authorization:'Bearer '+token}},auth:{persistSession:false,autoRefreshToken:false}});
  }
}
