import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, IsUUID, Max, Min } from 'class-validator';
import { ShrimpBatchStatus } from '../../../common/enums/shrimp-batch-status.enum.js';

export class CreateCropDto {
  @IsUUID('4') pondId: string;
  @IsDateString() stockingDate: string;
  @Type(() => Number) @IsInt() @IsPositive() initialQuantity: number;
  @IsString() @IsNotEmpty() shrimpSpecies: string;
  @IsOptional() @IsDateString() expectedHarvestDate?: string;
}
export class UpdateCropDto extends PartialType(CreateCropDto) {}
export class UpdateCropStatusDto { @IsEnum(ShrimpBatchStatus) status: ShrimpBatchStatus; }
export class FindCropsQueryDto {
  @IsOptional() @IsUUID('4') pondId?: string;
  @IsOptional() @IsUUID('4') farmId?: string;
  @IsOptional() @IsEnum(ShrimpBatchStatus) status?: ShrimpBatchStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 10;
}
export class CreateHarvestDto {
  @IsDateString() harvestDate: string;
  @IsOptional() @Type(() => Number) @IsInt() @IsPositive() harvestQuantity?: number;
  @Type(() => Number) @IsPositive() harvestWeightKg: number;
  @IsOptional() @IsString() note?: string;
}
