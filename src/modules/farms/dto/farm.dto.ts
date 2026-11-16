import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export class CreateFarmDto {
  @IsString() @IsNotEmpty() farmName: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.01) totalArea?: number;
  @IsOptional() @Matches(UUID_REGEX, { message: 'ownerId phải là chuỗi UUID hợp lệ!' }) ownerId?: string;
}
export class UpdateFarmDto extends PartialType(CreateFarmDto) {}
export class FindFarmsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 10;
  @IsOptional() @IsString() search?: string;
}
