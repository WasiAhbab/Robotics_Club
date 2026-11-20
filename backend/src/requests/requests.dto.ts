import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsDateString, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

export class RequestItemDto {
  @IsUUID() product_id: string;
  @IsInt() @Min(1) @Max(500) quantity: number;
}
export class CreateRequestDto {
  @IsString() @MinLength(3) @MaxLength(120) project_name: string;
  @IsString() @MinLength(3) @MaxLength(1000) purpose: string;
  /** Optional; defaults to today + club borrowing period. Format YYYY-MM-DD. */
  @IsOptional() @IsDateString() requested_due_date?: string;
  @IsOptional() @IsDateString() competition_date?: string;
  @IsOptional() @IsBoolean() is_group_request?: boolean;
  @IsOptional() @IsString() @MaxLength(80) group_name?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => RequestItemDto) items: RequestItemDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ArrayUnique() @IsUUID('all', { each: true }) participant_ids?: string[];
}
export class ReviewDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
