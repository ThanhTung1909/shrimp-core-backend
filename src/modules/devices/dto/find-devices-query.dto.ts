import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DeviceStatus } from '../../../common/enums/device-status.enum.js';

const CANONICAL_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class FindDevicesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100, {
    message: 'Mỗi trang tối đa 100 thiết bị!',
  })
  limit?: number = 10;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Matches(CANONICAL_UUID_REGEX, { message: 'pondId must be a UUID' })
  pondId?: string;

  @IsOptional()
  @IsEnum(DeviceStatus)
  status?: DeviceStatus;
}
