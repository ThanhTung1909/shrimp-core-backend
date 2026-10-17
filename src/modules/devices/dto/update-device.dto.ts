import { PartialType } from '@nestjs/mapped-types';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';
import { CreateDeviceDto } from './create-device.dto.js';

export class UpdateDeviceDto extends PartialType(CreateDeviceDto) {
  @ApiPropertyOptional({
    description: 'Thời gian hoạt động gần nhất của thiết bị (chuẩn ISO 8601)',
    example: '2026-09-19T10:00:00.000Z',
  })
  @IsOptional()
  @IsDateString({}, { message: 'Thời gian hoạt động gần nhất phải đúng định dạng ISO 8601!' })
  lastActiveAt?: string;
}



