import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { RequestsService } from './requests.service';
import { CreateRequestDto, ReviewDto } from './requests.dto';
import { CurrentUser, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { SettingsModule } from '../settings/settings.module';

@Controller('requests')
class RequestsController {
  constructor(private svc: RequestsService) {}
  @Post() create(@CurrentUser() u: AuthUser, @Body() dto: CreateRequestDto) { return this.svc.create(u, dto); }
  @Get() list(@CurrentUser() u: AuthUser, @Query('status') status?: string) { return this.svc.list(u, status); }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.get(u, id); }
  @Patch(':id/cancel') cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.cancel(u, id); }
  @Roles('super_admin', 'admin','moderator', 'secretary') @Post(':id/approve')
  approve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto) { return this.svc.approve(u, id, dto.note); }
  @Roles('super_admin', 'admin','moderator', 'secretary') @Post(':id/reject')
  reject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto) { return this.svc.reject(u, id, dto.note); }
}

@Module({ imports: [SettingsModule], controllers: [RequestsController], providers: [RequestsService] })
export class RequestsModule {}
