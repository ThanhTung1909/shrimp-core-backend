import {
  IsEnum,
  IsMACAddress,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DeviceStatus } from '../../../common/enums/device-status.enum.js';

export class CreateDeviceDto {
  @ApiProperty({ description: 'Tên thiết bị cảm biến IoT', example: 'Cảm biến pH/DO Ao 1' })
  @IsNotEmpty({ message: 'Tên thiết bị không được để trống!' })
  @IsString({ message: 'Tên thiết bị phải là chuỗi ký tự!' })
  @Length(2, 100, { message: 'Tên thiết bị phải từ 2 đến 100 ký tự!' })
  deviceName: string;

  @ApiProperty({ description: 'Địa chỉ MAC vật lý của thiết bị ESP32', example: '00:1B:44:11:3A:B7' })
  @IsNotEmpty({ message: 'Địa chỉ MAC không được để trống!' })
  @IsString({ message: 'Địa chỉ MAC phải là chuỗi ký tự!' })
  @IsMACAddress({
    message: 'Địa chỉ MAC không đúng định dạng!',
  })
  macAddress: string;

  @ApiPropertyOptional({ description: 'ID ao nuôi gắn thiết bị', example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsOptional()
  @IsUUID('4', { message: 'ID ao nuôi phải là UUID v4 hợp lệ!' })
  pondId?: string;

  @ApiPropertyOptional({ description: 'Phiên bản firmware hiện tại', example: 'v1.2.0' })
  @IsOptional()
  @IsString({ message: 'Phiên bản firmware phải là chuỗi ký tự!' })
  @Length(1, 50, { message: 'Phiên bản firmware từ 1 đến 50 ký tự!' })
  firmwareVersion?: string;

  @ApiPropertyOptional({ description: 'Trạng thái ban đầu của thiết bị', enum: DeviceStatus, example: DeviceStatus.ONLINE })
  @IsOptional()
  @IsEnum(DeviceStatus, { message: 'Trạng thái thiết bị không hợp lệ!' })
  status?: DeviceStatus;
}
