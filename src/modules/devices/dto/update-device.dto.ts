import { PartialType } from '@nestjs/mapped-types';
import { CreateDeviceDto } from './create-device.dto.js';
import { IsDateString, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateDeviceDto extends PartialType(CreateDeviceDto) {
  @ApiPropertyOptional({ description: 'Thời điểm thiết bị hoạt động gần nhất' })
  @IsOptional()
  @IsDateString({}, { message: 'Thời điểm hoạt động gần nhất không hợp lệ!' })
  lastActiveAt?: string;
}



