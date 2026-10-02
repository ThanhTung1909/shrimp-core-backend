import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PondStatus } from '../../../common/enums/pond-status.enum.js';

export class FindPondsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(PondStatus)
  status?: PondStatus;

  // Quản trị viên có thể lọc theo userId
  @IsOptional()
  @IsString()
  userId?: string;
}
