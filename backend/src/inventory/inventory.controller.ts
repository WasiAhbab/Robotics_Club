import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { MaintenanceDto, UnitDto, UpdateMaintenanceDto, UpdateUnitDto } from './inventory.dto';
import { CurrentUser, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';

@Controller('inventory')
export class InventoryController {
  constructor(private svc: InventoryService) {}

  @Roles('super_admin', 'admin', 'moderator', 'secretary') @Get('units')
  units(@Query('productId') productId?: string, @Query('status') status?: string) { return this.svc.units(productId, status); }
  @Roles('super_admin', 'admin', 'moderator') @Post('units')
  createUnit(@CurrentUser() u: AuthUser, @Body() dto: UnitDto) { return this.svc.createUnit(u.id, dto); }
  @Roles('super_admin', 'admin', 'moderator') @Patch('units/:id')
  updateUnit(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUnitDto) { return this.svc.updateUnit(u.id, id, dto); }

  @Roles('super_admin', 'admin', 'moderator') @Get('maintenance')
  maintenance(@Query('status') status?: string) { return this.svc.maintenance(status); }
  @Roles('super_admin', 'admin', 'moderator') @Post('maintenance')
  open(@CurrentUser() u: AuthUser, @Body() dto: MaintenanceDto) { return this.svc.openMaintenance(u.id, dto); }
  @Roles('super_admin', 'admin', 'moderator') @Patch('maintenance/:id')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMaintenanceDto) { return this.svc.updateMaintenance(u.id, id, dto); }

  @Roles('super_admin', 'admin', 'moderator', 'secretary') @Get('movements')
  movements(@Query('unitId') unitId?: string) { return this.svc.movements(unitId); }
}
