import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateFarmDto {
  @IsString() @IsNotEmpty() farmName: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.01) totalArea?: number;
}
export class UpdateFarmDto extends PartialType(CreateFarmDto) {}
export class FindFarmsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 10;
  @IsOptional() @IsString() search?: string;
}
