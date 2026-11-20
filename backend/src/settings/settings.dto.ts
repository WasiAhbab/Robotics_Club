import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const DEFAULT_PREFS = { borrowDays: 7, graceDays: 1, requestLimit: 3, onTimePoints: 5, latePenalty: 5, nonReturnPenalty: 20 };
export type Preferences = typeof DEFAULT_PREFS;

export class PreferencesDto {
  @IsOptional() @IsInt() @Min(1) @Max(90) borrowDays?: number;
  @IsOptional() @IsInt() @Min(0) @Max(30) graceDays?: number;
  @IsOptional() @IsInt() @Min(1) @Max(20) requestLimit?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) onTimePoints?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) latePenalty?: number;
  @IsOptional() @IsInt() @Min(0) @Max(500) nonReturnPenalty?: number;
}
