import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class QueryAlertDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;

  @IsOptional()
  @IsUUID()
  pondId?: string;

  @IsOptional()
  @IsUUID()
  deviceId?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isResolved?: boolean;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
