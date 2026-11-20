import { Body, Controller, Get, Module, ParseIntPipe, Put, Query } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { PreferencesDto } from './settings.dto';
import { CurrentUser, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';

@Controller()
class SettingsController {
  constructor(private svc: SettingsService) {}
  @Roles('super_admin', 'admin', 'moderator') @Get('settings/preferences') preferences() { return this.svc.preferences(); }
  @Roles('super_admin', 'admin', 'moderator') @Put('settings/preferences')
  update(@CurrentUser() u: AuthUser, @Body() dto: PreferencesDto) { return this.svc.update(u.id, dto); }
  @Roles('super_admin', 'admin','moderator') @Get('audit-logs')
  audit(@Query('limit', new ParseIntPipe({ optional: true })) limit?: number) { return this.svc.auditLogs(limit ?? 100); }
}

@Module({ controllers: [SettingsController], providers: [SettingsService], exports: [SettingsService] })
export class SettingsModule {}
