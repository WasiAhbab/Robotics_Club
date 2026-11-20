import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SupabaseService } from '../supabase/supabase.service';
import { IS_PUBLIC } from './decorators';
import { AuthUser } from './auth.types';

/** Verifies the Supabase access token sent by the frontend and loads the club profile/role. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector, private sb: SupabaseService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    if (!token) throw new UnauthorizedException('Missing bearer token');

    const { data, error } = await this.sb.admin.auth.getUser(token);
    if (error || !data.user) throw new UnauthorizedException('Invalid or expired token');

    const {data:profile} = await this.sb.asUser(token).from('workspace_members')
      .select('id,name,role').eq('id',data.user.id).maybeSingle();
    if(!profile) throw new ForbiddenException('Active membership required');
    req.user={id:profile.id,token,email:data.user.email,role:profile.role.toLowerCase().replace(' ','_'),fullName:profile.name} as AuthUser;
    return true;
  }
}
