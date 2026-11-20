import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CategoryDto {
  @IsString() @MinLength(2) @MaxLength(80) name: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
}
export class UpdateCategoryDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
}
const PRODUCT_CONDITIONS = ['excellent','good','fair','repairable','damaged','unusable'];

export class ProductDto {
  @IsString() @MinLength(2) @MaxLength(120) name: string;
  @IsString() @MinLength(2) @MaxLength(40) sku: string;
  @IsOptional() @IsUUID() category_id?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsIn(PRODUCT_CONDITIONS) condition?: string;
  @IsOptional() @IsString() @MaxLength(300) image_path?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100) individual_cap?: number;
  @IsOptional() @IsInt() @Min(1) @Max(500) group_cap?: number;
}
export class UpdateProductDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(40) sku?: string;
  @IsOptional() @IsUUID() category_id?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsIn(PRODUCT_CONDITIONS) condition?: string;
  @IsOptional() @IsString() @MaxLength(300) image_path?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100) individual_cap?: number;
  @IsOptional() @IsInt() @Min(1) @Max(500) group_cap?: number;
  @IsOptional() @IsBoolean() is_active?: boolean;
}
