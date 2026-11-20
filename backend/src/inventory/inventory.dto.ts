import { IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';

export const CONDITIONS = ['excellent', 'good', 'fair', 'repairable', 'damaged', 'unusable'] as const;
export const UNIT_STATUSES = ['available', 'maintenance', 'retired', 'lost'] as const; // on_loan is set only by loan flow

export class UnitDto {
  @IsUUID() product_id: string;
  @IsString() @MinLength(2) @MaxLength(60) asset_tag: string;
  @IsOptional() @IsString() @MaxLength(80) serial_number?: string;
  @IsOptional() @IsIn(CONDITIONS) condition?: (typeof CONDITIONS)[number];
  @IsOptional() @IsString() @MaxLength(120) storage_location?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() @IsDateString() acquired_at?: string;
}
export class UpdateUnitDto {
  @IsOptional() @IsString() @MaxLength(80) serial_number?: string;
  @IsOptional() @IsIn(CONDITIONS) condition?: (typeof CONDITIONS)[number];
  @IsOptional() @IsIn(UNIT_STATUSES) status?: (typeof UNIT_STATUSES)[number];
  @IsOptional() @IsString() @MaxLength(120) storage_location?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}
export class MaintenanceDto {
  @IsUUID() inventory_unit_id: string;
  @IsString() @MinLength(3) @MaxLength(1000) issue: string;
}
export class UpdateMaintenanceDto {
  @IsIn(['open', 'in_progress', 'resolved', 'written_off']) status: 'open' | 'in_progress' | 'resolved' | 'written_off';
  @IsOptional() @IsNumber() @Min(0) cost?: number;
}
